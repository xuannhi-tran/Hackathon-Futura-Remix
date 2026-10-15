import {
  PROFILE_REQUIRED_HINT,
  REQUIRED_FIELD_LABELS,
  type RequiredProfileField,
} from "../lib/profileRequirements";

// Shown under the Analyse button while a required profile field is unset.
// The "!" and the wording carry the meaning, so colour is never the only cue.
export default function ProfileRequiredHint({
  missing,
  onSetUp,
}: {
  missing: RequiredProfileField[];
  onSetUp: () => void;
}) {
  if (missing.length === 0) return null;

  return (
    <div
      id="profile-required-hint"
      className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <p className="text-sm font-semibold text-amber-900">
        <span aria-hidden="true">! </span>
        {PROFILE_REQUIRED_HINT}
      </p>
      <p className="mt-1 text-sm text-amber-900">
        Still to set: {missing.map((field) => REQUIRED_FIELD_LABELS[field]).join(", ")}.
      </p>
      <button
        type="button"
        onClick={onSetUp}
        className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
      >
        Set up your profile
      </button>
    </div>
  );
}
