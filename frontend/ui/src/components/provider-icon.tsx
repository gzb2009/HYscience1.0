import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import type { IconName } from "./provider-icons/types"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: IconName
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  // Legacy models.dev / session ids used "synthetic"; icon asset is now "hybio".
  const id = () => ((local.id as string) === "synthetic" ? "hybio" : local.id) as IconName
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${id()}`} />
    </svg>
  )
}
