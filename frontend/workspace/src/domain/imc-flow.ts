import { IconCells, IconChart, IconGraph, IconMatrix, IconScatter, IconSigma } from "@/thesis/shared/Icon"

export const IMC_STEPS = [
  ["chat.welcome.imc.flow.s1", "chat.welcome.imc.flow.h1", "chat.welcome.imc.flow.p1", IconMatrix],
  ["chat.welcome.imc.flow.s2", "chat.welcome.imc.flow.h2", "chat.welcome.imc.flow.p2", IconCells],
  ["chat.welcome.imc.flow.s3", "chat.welcome.imc.flow.h3", "chat.welcome.imc.flow.p3", IconSigma],
  ["chat.welcome.imc.flow.s4", "chat.welcome.imc.flow.h4", "chat.welcome.imc.flow.p4", IconScatter],
  ["chat.welcome.imc.flow.s5", "chat.welcome.imc.flow.h5", "chat.welcome.imc.flow.p5", IconGraph],
  ["chat.welcome.imc.flow.s6", "chat.welcome.imc.flow.h6", "chat.welcome.imc.flow.p6", IconChart],
] as const
