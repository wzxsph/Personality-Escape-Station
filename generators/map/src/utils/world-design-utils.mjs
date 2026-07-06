const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeInteraction = (interaction, index) => ({
  id: interaction?.id || `interaction_${index + 1}`,
  name: interaction?.name || interaction?.label || `互动 ${index + 1}`,
  description: interaction?.description || "",
});

const normalizeRegion = (region, index) => ({
  id: region?.id || `region_${index + 1}`,
  name: region?.name || region?.label || `区域 ${index + 1}`,
  description: region?.description || "",
  type: region?.type || "area",
  enterable: region?.enterable !== false,
  shapeConstraint: region?.shapeConstraint || "",
  placementHint: region?.placementHint || "",
  visualDescription: region?.visualDescription || region?.description || "",
  interactions: asArray(region?.interactions).map(normalizeInteraction),
});

const normalizeElement = (element, index) => ({
  id: element?.id || `element_${index + 1}`,
  name: element?.name || element?.label || `互动点 ${index + 1}`,
  description: element?.description || "",
  visualDescription: element?.visualDescription || element?.description || "",
  placementHint: element?.placementHint || "",
  interactions: asArray(element?.interactions).map(normalizeInteraction),
});

export function normalizeWorldDesign(raw = {}) {
  return {
    ...raw,
    mapAspectRatio: raw.mapAspectRatio || "9:16",
    mapDescription: raw.mapDescription || raw.worldDescription || "",
    mapPlan: {
      buildingMode: raw.mapPlan?.buildingMode || "personality_room",
      compositionNotes: raw.mapPlan?.compositionNotes || raw.mapPlan?.layout || "",
      worldFunctionSummary: raw.mapPlan?.worldFunctionSummary || raw.worldDescription || "",
      regionDesignNotes: raw.mapPlan?.regionDesignNotes || "",
      ...raw.mapPlan,
    },
    worldActions: asArray(raw.worldActions),
    regions: asArray(raw.regions).map(normalizeRegion),
    interactiveElements: asArray(raw.interactiveElements).map(normalizeElement),
  };
}
