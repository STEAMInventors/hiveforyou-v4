const HEX_POINTS = "12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7";

const VALUE_POINTS = [
  {
    fillClass: "fill-blue",
    title: "Upload whatever you have",
    description:
      "Letters, statements, forms. Old, partial or out of order is fine.",
  },
  {
    fillClass: "fill-leaf",
    title: "Every point opens its page",
    description: "Each date, amount and finding links to where it came from.",
  },
  {
    fillClass: "fill-coral",
    title: "See what is missing",
    description: "The list of what the documents refer to but don't include.",
  },
] as const;

const EXAMPLE_ITEMS = [
  {
    title: "Bank statements, 3 months",
    state: "In",
    fillClass: "fill-leaf",
    strokeClass: "stroke-leaf",
    pillClass: "bg-checked-bg text-checked-fg",
  },
  {
    title: "Pay stubs, last 60 days",
    state: "Waiting",
    fillClass: "fill-honey-wash",
    strokeClass: "stroke-honey",
    pillClass: "bg-changed-bg text-changed-fg",
  },
  {
    title: "Tax return, last year",
    state: "Missing",
    fillClass: "fill-paper",
    strokeClass: "stroke-coral",
    pillClass: "bg-missing-bg text-missing-fg",
  },
] as const;

function SmallHexagon({
  fillClass,
  strokeClass,
}: {
  fillClass: string;
  strokeClass?: string;
}) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <polygon
        points={HEX_POINTS}
        className={
          strokeClass
            ? `${fillClass} ${strokeClass} stroke-2 [stroke-linejoin:round]`
            : fillClass
        }
      />
    </svg>
  );
}

export function AuthAboutAside() {
  return (
    <aside
      aria-label="About HiveForYou"
      className="hidden min-h-dvh flex-1 items-center justify-center bg-mist px-5 py-12 min-[960px]:flex min-[960px]:px-12"
    >
      <div className="flex w-full max-w-[460px] flex-col gap-7">
        <svg width={172} height={170} viewBox="0 0 172 170" aria-hidden className="shrink-0">
          <polygon
            points="60,10 86,25 86,55 60,70 34,55 34,25"
            className="fill-blue"
          />
          <polygon
            points="112,10 138,25 138,55 112,70 86,55 86,25"
            className="fill-blue-wash"
          />
          <polygon
            points="34,55 60,70 60,100 34,115 8,100 8,70"
            className="fill-leaf"
          />
          <polygon
            points="86,55 112,70 112,100 86,115 60,100 60,70"
            className="fill-coral"
          />
          <polygon
            points="138,55 164,70 164,100 138,115 112,100 112,70"
            className="fill-leaf-wash"
          />
          <polygon
            points="60,100 86,115 86,145 60,160 34,145 34,115"
            className="fill-honey"
          />
          <polygon
            points="112,100 138,115 138,145 112,160 86,145 86,115"
            className="fill-coral-wash"
          />
        </svg>

        <h2 className="m-0 font-brand text-[34px] font-semibold leading-[1.15] text-ink">
          Every page read.
          <br />
          Nothing missed.
        </h2>

        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {VALUE_POINTS.map((point) => (
            <li key={point.title} className="flex items-start gap-3">
              <svg
                width={20}
                height={20}
                viewBox="0 0 24 24"
                aria-hidden
                className="mt-0.5 shrink-0"
              >
                <polygon points={HEX_POINTS} className={point.fillClass} />
              </svg>
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold text-ink">{point.title}</span>
                <span className="text-[14.5px] leading-normal text-ink-2">
                  {point.description}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2.5 rounded-input border border-line bg-paper px-[18px] py-4 shadow-[0_8px_24px_rgba(31,35,40,0.06)]">
          <p className="m-0 text-xs font-semibold text-ink-3">
            Example: what this hive needs · 1 of 3 in
          </p>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {EXAMPLE_ITEMS.map((item) => (
              <li key={item.title} className="flex items-center gap-2.5">
                <SmallHexagon fillClass={item.fillClass} strokeClass={item.strokeClass} />
                <span className="flex-1 text-sm text-ink">{item.title}</span>
                <span
                  className={`inline-flex h-[22px] items-center rounded-pill px-2 text-[11.5px] font-semibold ${item.pillClass}`}
                >
                  {item.state}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="m-0 text-[12.5px] leading-normal text-ink-3">
          Your documents stay private to your account. Not legal, financial or medical advice.
        </p>
      </div>
    </aside>
  );
}