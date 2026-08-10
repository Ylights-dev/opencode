import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 72 71"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image href="./favicon-v3.svg" width="72" height="71" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 72 71"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image href="./favicon-v3.svg" width="72" height="71" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 430 72"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <image href="./favicon-v3.svg" x="0" y="0" width="72" height="71" />
      <text x="92" y="46" fill="var(--icon-strong-base)" font-family="Arial, sans-serif" font-size="32" font-weight="700">
        СЕМЕНА - АГЕНТ
      </text>
    </svg>
  )
}
