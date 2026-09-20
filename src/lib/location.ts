export const AUSTRALIAN_STATES = [
  { value: "", label: "Anywhere in Australia", fullName: "" },
  { value: "NSW", label: "NSW - New South Wales", fullName: "New South Wales" },
  { value: "VIC", label: "VIC - Victoria", fullName: "Victoria" },
  { value: "QLD", label: "QLD - Queensland", fullName: "Queensland" },
  { value: "WA", label: "WA - Western Australia", fullName: "Western Australia" },
  { value: "SA", label: "SA - South Australia", fullName: "South Australia" },
  { value: "TAS", label: "TAS - Tasmania", fullName: "Tasmania" },
  { value: "ACT", label: "ACT - Australian Capital Territory", fullName: "Australian Capital Territory" },
  { value: "NT", label: "NT - Northern Territory", fullName: "Northern Territory" },
];

export const MAJOR_CITIES: Record<string, string> = {
  sydney: "NSW",
  newcastle: "NSW",
  wollongong: "NSW",
  parramatta: "NSW",
  melbourne: "VIC",
  geelong: "VIC",
  brisbane: "QLD",
  "gold coast": "QLD",
  perth: "WA",
  adelaide: "SA",
  hobart: "TAS",
  canberra: "ACT",
  darwin: "NT",
};

export function matchesState(jobLocationText: string, preferredStateAbbr: string): boolean {
  if (!preferredStateAbbr || preferredStateAbbr.trim() === "") return true;

  const text = jobLocationText.toLowerCase();
  const stateObj = AUSTRALIAN_STATES.find((s) => s.value === preferredStateAbbr);
  if (!stateObj) return false;

  const abbrRegex = new RegExp(`\\b${stateObj.value}\\b`, "i");
  if (abbrRegex.test(text)) return true;

  if (text.includes(stateObj.fullName.toLowerCase())) return true;

  for (const [city, abbr] of Object.entries(MAJOR_CITIES)) {
    if (abbr === preferredStateAbbr && new RegExp(`\\b${city}\\b`, "i").test(text)) {
      return true;
    }
  }

  return false;
}

export function getStateFullName(abbr: string): string {
  const state = AUSTRALIAN_STATES.find((s) => s.value === abbr);
  return state?.fullName || abbr;
}
