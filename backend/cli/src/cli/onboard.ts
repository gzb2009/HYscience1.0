import * as prompts from "@clack/prompts"
import path from "path"
import { cmd } from "./cmd/cmd"
import { UI } from "./ui"
import { Auth } from "../auth"
import { Config } from "../config/config"
import { Global } from "../global"
import { AuthLoginCommand } from "./cmd/auth"

const MARKER = path.join(Global.Path.state, "onboarded")

const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CEREBRAS_API_KEY",
  "TOGETHER_API_KEY",
  "PERPLEXITY_API_KEY",
]

function hasProviderEnv(): boolean {
  return PROVIDER_ENV_KEYS.some((k) => !!process.env[k])
}

export async function isConfigured(): Promise<boolean> {
  if (hasProviderEnv()) return true
  try {
    if (Object.keys(await Auth.all()).length > 0) return true
  } catch {}
  try {
    const config = await Config.get()
    if (config.model) return true
  } catch {}
  return false
}

async function isOnboarded(): Promise<boolean> {
  try {
    return await Bun.file(MARKER).exists()
  } catch {
    return false
  }
}

async function markOnboarded(): Promise<void> {
  try {
    await Bun.write(MARKER, new Date().toISOString() + "\n")
  } catch {}
}

export async function needsOnboarding(): Promise<boolean> {
  if (process.env.HYSCIENCE_NO_ONBOARD === "1") return false
  if (process.env.CI) return false
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  if (await isOnboarded()) return false
  if (await isConfigured()) return false
  return true
}

async function onboardByok(): Promise<void> {
  prompts.log.info(
    "Add a provider API key or sign in with a subscription (ChatGPT, Claude Max, Copilot). Keys stay on this machine.",
  )
  await AuthLoginCommand.handler({} as never)
}

function onboardSkip(): void {
  prompts.log.info("Skipped for now. Add keys anytime with `hyscience keys add`.")
}

export async function runOnboarding(opts?: { force?: boolean }): Promise<void> {
  prompts.intro(opts?.force ? "HYscience setup" : "Welcome to HYscience")

  const choice = await prompts.select({
    message: "How do you want to power the models?",
    initialValue: "byok",
    options: [
      { value: "byok", label: "Your own keys", hint: "Anthropic · OpenAI · Google · 100+ providers" },
      { value: "skip", label: "Not now", hint: "configure later in Settings → Credentials" },
    ],
  })
  if (prompts.isCancel(choice)) {
    prompts.cancel("Setup cancelled — run `hyscience init` whenever you're ready.")
    await markOnboarded()
    return
  }

  if (choice === "byok") await onboardByok()
  else onboardSkip()

  await markOnboarded()
  prompts.outro("You're all set.")
}

export const InitCommand = cmd({
  command: ["init", "onboard"],
  describe: "set up HYscience — provider keys and default model",
  async handler() {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    await runOnboarding({ force: true })
  },
})

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check what's configured and what's missing",
  async handler() {
    UI.empty()
    prompts.intro("hyscience doctor")

    try {
      const keys = Object.keys(await Auth.all())
      if (keys.length) prompts.log.success(`Provider keys: ${keys.join(", ")}`)
      else prompts.log.info("Provider keys: none  (run `hyscience keys add`)")
    } catch {}

    const envKeys = PROVIDER_ENV_KEYS.filter((k) => !!process.env[k])
    if (envKeys.length) prompts.log.info(`Environment keys: ${envKeys.join(", ")}`)

    try {
      const config = await Config.get()
      prompts.log.info(`Default model: ${config.model ?? "auto (chosen from available providers)"}`)
    } catch {}

    if (!(await isConfigured())) {
      prompts.log.warn("No model source configured — run `hyscience init` or `hyscience keys add`.")
    }
    prompts.outro("Done")
  },
})
