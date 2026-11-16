"use client";

// Searchable garden list (by name, location or type) built on SearchList
import { MapPin } from "lucide-react";
import { SearchList } from "@/components/SearchList";

// The few garden fields the list needs
export interface PickerGarden {
  id: string;
  name: string;
  location?: string | null;
  type?: string;
}

// Garden list that reports the chosen garden through onChoose
export function GardenSearchList({
  gardens,
  onChoose,
  selectedId,
  allLabel,
  heading,
}: {
  gardens: PickerGarden[];
  onChoose: (garden: PickerGarden) => void;
  selectedId?: string;
  /** Adds an "all gardens" row (id "all") above the list while not searching. */
  allLabel?: string;
  heading?: string;
}) {
  // Quick lookup from garden id to garden object
  const byId = new Map(gardens.map((garden) => [garden.id, garden]));
  return (
    <SearchList
      heading={heading}
      placeholder="Search by name or area…"
      emptyText="No gardens match"
      subtitleIcon={MapPin}
      selectedId={selectedId}
      pinned={allLabel ? [{ id: "all", title: allLabel, subtitle: `${gardens.length} gardens` }] : []}
      items={gardens.map((garden) => ({
        id: garden.id,
        title: garden.name,
        subtitle: garden.location || "No location set",
        keywords: [garden.type],
      }))}
      onChoose={(item) => onChoose(byId.get(item.id) ?? { id: item.id, name: item.title })}
    />
  );
}
