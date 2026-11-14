import { cn } from "@clichy/ui/lib/utils";

type BrandLogoProps = {
  className?: string;
  markOnly?: boolean;
};

export function BrandLogo({ className, markOnly = false }: BrandLogoProps) {
  const viewBox = markOnly ? "0 0 44 44" : "0 0 194 48";

  return (
    <svg
      aria-label={markOnly ? "Clichy" : undefined}
      aria-hidden={markOnly ? undefined : true}
      className={cn("text-foreground", className)}
      fill="none"
      role={markOnly ? "img" : undefined}
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="42" height="42" rx="14" fill="currentColor" />
      <path
        d="M27.5 13.6h-5.6a8.6 8.6 0 1 0 0 17.2h5.6"
        stroke="var(--background)"
        strokeLinecap="round"
        strokeWidth="3.6"
      />
      <rect
        x="24.8"
        y="13.2"
        width="9.2"
        height="9.2"
        rx="3"
        fill="var(--brand-clay)"
      />
      <rect
        x="26.4"
        y="25.2"
        width="9.2"
        height="9.2"
        rx="3"
        fill="var(--brand-sage)"
        stroke="var(--background)"
        strokeWidth="1.2"
      />
      {!markOnly && (
        <text
          x="56"
          y="33"
          fill="currentColor"
          fontFamily="Inter, Avenir Next, ui-sans-serif, system-ui, sans-serif"
          fontSize="30"
          fontWeight="650"
          letterSpacing="-1.5"
        >
          clichy
        </text>
      )}
    </svg>
  );
}
