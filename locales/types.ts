import type { Message } from "../i18n";
import type { Language } from "../preferences";

export type TranslatedMessage = Record<Exclude<Language, "zh" | "en">, string>;
export type TranslationCatalog = Partial<Record<Message, TranslatedMessage>>;
