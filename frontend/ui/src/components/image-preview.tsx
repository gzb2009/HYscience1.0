import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Show } from "solid-js"
import { useDialog, useDialogLite } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface ImagePreviewProps {
  src: string
  alt?: string
}

function PreviewBody(props: ImagePreviewProps) {
  const i18n = useI18n()
  const dialog = useDialog()
  const lite = useDialogLite()
  return (
    <>
      <div data-slot="image-preview-header">
        <Show
          when={lite}
          fallback={
            <Kobalte.CloseButton
              data-slot="image-preview-close"
              as={IconButton}
              icon="close"
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
            />
          }
        >
          <IconButton
            data-slot="image-preview-close"
            icon="close"
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
            onClick={() => dialog.close()}
          />
        </Show>
      </div>
      <div data-slot="image-preview-body">
        <img src={props.src} alt={props.alt ?? i18n.t("ui.imagePreview.alt")} data-slot="image-preview-image" />
      </div>
    </>
  )
}

export function ImagePreview(props: ImagePreviewProps) {
  const lite = useDialogLite()
  return (
    <div data-component="image-preview" data-lite={lite ? "" : undefined}>
      <div data-slot="image-preview-container">
        <Show
          when={lite}
          fallback={
            <Kobalte.Content data-slot="image-preview-content">
              <PreviewBody {...props} />
            </Kobalte.Content>
          }
        >
          <div data-slot="image-preview-content">
            <PreviewBody {...props} />
          </div>
        </Show>
      </div>
    </div>
  )
}
