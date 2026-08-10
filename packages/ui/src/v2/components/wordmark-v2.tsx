import type { ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      role="img"
      aria-label="Семена - Агент"
    >
      <g opacity="0.12" fill="currentColor">
        <image href="./favicon-v3.svg" x="8" y="13" width="100" height="100" />
        <text x="116" y="88" font-family="Arial, sans-serif" font-size="62" font-weight="700">
          СЕМЕНА - АГЕНТ
        </text>
      </g>
    </svg>
  )
}
