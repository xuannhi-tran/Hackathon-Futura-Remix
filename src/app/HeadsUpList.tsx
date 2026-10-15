import type { HeadsUp } from "../lib/headsUp";

// Non-visa observations shown inside the verdict card. The verdict itself is
// never affected. Each item carries a text prefix, so colour is never the only cue.
export default function HeadsUpList({ headsUps }: { headsUps: HeadsUp[] }) {
  if (headsUps.length === 0) return null;

  return (
    <section
      aria-labelledby="heads-up-heading"
      className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <h3
        id="heads-up-heading"
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-900"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900"
        >
          !
        </span>
        Heads-up
      </h3>
      <p className="mt-1 text-xs text-gray-600">
        These do not change the result above.
      </p>

      <ul className="mt-3 space-y-3">
        {headsUps.map((headsUp) => (
          <li key={headsUp.id} className="text-sm leading-6 text-gray-800">
            <span className="font-semibold">
              {headsUp.severity === "warn" ? "Worth checking: " : "Note: "}
            </span>
            {headsUp.message}
            {headsUp.evidence && (
              <blockquote className="mt-1 break-words border-l-2 border-amber-300 pl-3 text-xs leading-5 text-gray-600 [overflow-wrap:anywhere]">
                &ldquo;{headsUp.evidence.text}&rdquo;
              </blockquote>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
