// API /api/disease-detection/analyze: diagnose a leaf photo and save the result
import { NextResponse } from "next/server";
import type { Severity } from "@prisma/client";
import { requireUser } from "@/lib/api-auth";
import { analyzeLeafImage, healthContributionFromPrediction, localAiAvailable, type AiPrediction } from "@/lib/ai";
import { modelCropFor } from "@/lib/model-crops";
import { getDiseaseEngine } from "@/lib/ai-settings";
import { diagnoseOnline } from "@/lib/ai-vision";
import { deleteDiseaseImage, saveDiseaseImage, validateDiseaseImage } from "@/lib/disease-images";
import { prisma } from "@/lib/db";
import { formatDiseaseAnalysisNotification } from "@/lib/business-notifications";
import { enqueueTelegramDelivery } from "@/lib/telegram-delivery-enqueue";
import { createAppNotification } from "@/lib/notify";

export const runtime = "nodejs";

// Turn the AI's severity text into the database's Severity value
function mapSeverity(s: AiPrediction["severity"]): Severity {
  return s === "high" ? "high" : s === "medium" ? "medium" : "low";
}

// POST: check the photo, run the AI, then save report, history and alerts
export async function POST(req: Request) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const userId = gate;

  try {
    const form = await req.formData();
    const file = form.get("file");
    const gardenId = form.get("gardenId");
    const potId = form.get("potId");
    const submittedPlantId = form.get("plantId");

    // Validation: need an image file, a garden and a pot
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "An image file is required (field 'file')" }, { status: 400 });
    }
    if (typeof gardenId !== "string" || typeof potId !== "string") {
      return NextResponse.json({ error: "Garden and pot are required" }, { status: 400 });
    }
    // Check the image type and size
    try {
      validateDiseaseImage(file);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid image" }, { status: 400 });
    }

    // Derive the plant from the owned pot; never trust a client-provided plant.
    const pot = await prisma.pot.findFirst({
      where: { id: potId, gardenId, userId },
      include: { plant: { select: { id: true, gardenId: true, commonName: true } } },
    });
    if (!pot) return NextResponse.json({ error: "Pot not found for selected garden" }, { status: 404 });
    if (!pot.plant) return NextResponse.json({ error: "Select a pot with an assigned plant" }, { status: 422 });
    const plant = pot.plant;
    if (submittedPlantId && submittedPlantId !== plant.id) {
      return NextResponse.json({ error: "Selected plant does not belong to this pot" }, { status: 400 });
    }

    const garden = await prisma.garden.findFirst({ where: { id: gardenId, userId }, select: { id: true, name: true } });
    if (!garden || plant.gardenId !== gardenId) {
      return NextResponse.json({ error: "Garden not found" }, { status: 404 });
    }

    const filename = file instanceof File && file.name ? file.name : "leaf.jpg";
    // The engine chosen in Settings → Disease AI: the local model, Gemini or Groq.
    const engine = await getDiseaseEngine(userId);
    const localOk = localAiAvailable();
    if (engine.provider === "LOCAL" && !localOk) {
      return NextResponse.json(
        { error: "Disease AI isn't set up on this site. Add a free Gemini or Groq key in Settings → Disease AI." },
        { status: 503 },
      );
    }
    // Run the AI: online engine first if chosen, local model as backup
    let prediction: AiPrediction & { summary?: string };
    let engineUsed = "local";
    let fallbackReason: string | null = null;
    // Tell the local model the crop so it only checks that crop's diseases
    const runLocal = () => analyzeLeafImage(file, filename, modelCropFor(plant.commonName));
    try {
      if (engine.provider === "LOCAL") {
        prediction = await runLocal();
      } else {
        try {
          prediction = await diagnoseOnline({ provider: engine.provider, apiKey: engine.apiKey, model: engine.model, image: file, plantName: plant.commonName });
          engineUsed = prediction.modelVersion;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "The online AI failed.";
          // No local model to fall back to on the live site.
          if (!engine.fallbackToLocal || !localOk) return NextResponse.json({ error: reason }, { status: 502 });
          console.warn("Online AI failed, using the local model:", reason);
          fallbackReason = reason;
          prediction = await runLocal();
        }
      }
    } catch (error) {
      console.error("AI service call failed:", error);
      return NextResponse.json({ error: "Disease detection service is unavailable" }, { status: 502 });
    }

    // Save the photo privately; both the report and history rows point to it
    const image = await saveDiseaseImage(file);
    try {
      const healthScoreContribution = healthContributionFromPrediction(prediction);
      // DB write: report, history, plant health and alerts all-or-nothing
      const { report, history } = await prisma.$transaction(async (tx) => {
        const report = await tx.diseaseReport.create({
          data: {
            userId,
            plantId: plant.id,
            cropName: prediction.crop,
            diseaseName: prediction.disease,
            className: prediction.className,
            confidence: prediction.confidence,
            severity: mapSeverity(prediction.severity),
            symptoms: prediction.symptoms ?? [],
            treatmentImmediate: prediction.treatment?.immediate ?? [],
            treatmentOrganic: prediction.treatment?.organic ?? [],
            treatmentChemical: prediction.treatment?.chemical ?? [],
            treatmentPrevention: prediction.treatment?.prevention ?? [],
            recommendation: prediction.recommendation,
            imageUrls: [image.imageRef],
            healthScoreContribution,
          },
        });
        const history = await tx.diseasePrediction.create({
          data: {
            userId,
            gardenId,
            potId,
            plantId: plant.id,
            imageRef: image.imageRef,
            imageMimeType: image.imageMimeType,
            predictedDisease: prediction.disease,
            className: prediction.className,
            confidence: prediction.confidence,
            details: {
              alternatives: prediction.alternatives ?? [],
              uncertain: prediction.uncertain ?? false,
              restrictedTo: prediction.restrictedTo ?? null,
              lookedLike: prediction.lookedLike ?? null,
              cropMatch: prediction.cropMatch ?? null,
              engine: engineUsed,
              summary: prediction.summary ?? null,
              fallbackReason,
            },
          },
        });
        await tx.plant.update({
          where: { id: plant.id },
          // Unsure about a disease: "at risk" rather than calling it diseased.
          data: {
            healthStatus: prediction.className.toLowerCase().includes("healthy")
              ? "healthy"
              : prediction.uncertain
                ? "at_risk"
                : "diseased",
          },
        });
        // Queue a Telegram message and an in-app notification about the result
        await enqueueTelegramDelivery(tx, {
          userId,
          eventKey: `disease-analysis:${history.id}`,
          eventType: "DISEASE_ANALYSIS_COMPLETED",
          eventRef: history.id,
          messageText: formatDiseaseAnalysisNotification({
            gardenName: garden.name,
            potLabel: pot.label,
            predictedDisease: history.predictedDisease,
            confidence: history.confidence,
            occurredAt: history.createdAt,
          }),
        });
        const healthy = prediction.className.toLowerCase().includes("healthy");
        await createAppNotification(tx, {
          userId,
          gardenId,
          potId,
          plantId: plant.id,
          type: healthy ? "info" : "alert",
          severity: healthy ? "low" : "high",
          title: healthy
            ? `${pot.label} looks healthy`
            : prediction.uncertain
              ? `${pot.label}: not sure — maybe ${prediction.disease}`
              : `Possible disease on ${pot.label}: ${prediction.disease}`,
          message: `${garden.name}: ${Math.round(prediction.confidence * 100)}% confidence.${
            prediction.uncertain ? " The AI isn't sure — retake the photo for a better result." : healthy ? "" : " Open the result for treatment steps."
          }`,
          actionUrl: "/disease-detection",
        });
        return { report, history };
      });
      return NextResponse.json({ prediction, report, history }, { status: 201 });
    } catch (error) {
      // DB save failed: delete the stored photo so it isn't left orphaned
      await deleteDiseaseImage(image.imageRef);
      throw error;
    }
  } catch (error) {
    console.error("Disease analyze error:", error);
    return NextResponse.json({ error: "Failed to analyze image" }, { status: 500 });
  }
}
