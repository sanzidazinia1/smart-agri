// API /api/disease-detection/images/[id]: show the leaf photo of a diagnosis
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { readDiseaseImage } from "@/lib/disease-images";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET: send the private photo, only to the user who owns it
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  // Ownership check: the diagnosis must belong to this user
  const prediction = await prisma.diseasePrediction.findFirst({
    where: { id, userId: gate },
    select: { imageRef: true, imageMimeType: true },
  });
  if (!prediction) return NextResponse.json({ error: "Prediction not found" }, { status: 404 });

  const image = await readDiseaseImage(prediction.imageRef);
  if (image) {
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": prediction.imageMimeType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }
  return NextResponse.json({ error: "Prediction image not found" }, { status: 404 });
}
