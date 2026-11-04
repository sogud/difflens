import type { TranslationCatalog } from "./types";

export const syncChinese = {
  "Committed locally.": "已提交到本地。",
  "{count} commits to push": "{count} 个提交待推送",
  "{count} commits to pull": "{count} 个提交待拉取",
  "No commits to push": "无待推送提交",
  "Push confirmed": "已确认推送",
  "Push not confirmed": "推送未确认",
  "Push succeeded; refresh status": "已推送，刷新状态",
  "Not tracking an upstream": "未关联上游",
  "Upstream status unavailable": "上游状态未知",
  "Publish branch": "发布分支",
  "Detached HEAD": "分离 HEAD",
  "Diverged · ↑{ahead} ↓{behind}": "已分叉 · ↑{ahead} ↓{behind}",
  "Compared with the local upstream record; fetch to refresh remote information.": "与本机保存的上游记录比较；获取远程信息后更新。",
  "Push confirmed, but status refresh failed: {error}": "推送已确认，但刷新状态失败：{error}",
} as const;

export const syncTranslations = {
  "Committed locally.": { ja: "ローカルにコミットしました。", ko: "로컬에 커밋했습니다.", fr: "Commit créé localement.", de: "Lokal committet.", es: "Commit creado localmente.", pt: "Commit criado localmente." },
  "{count} commits to push": { ja: "{count} 件の未プッシュコミット", ko: "푸시할 커밋 {count}개", fr: "{count} commits à envoyer", de: "{count} Commits zum Pushen", es: "{count} commits por enviar", pt: "{count} commits para enviar" },
  "{count} commits to pull": { ja: "{count} 件の未取得コミット", ko: "가져올 커밋 {count}개", fr: "{count} commits à récupérer", de: "{count} Commits zum Pullen", es: "{count} commits por traer", pt: "{count} commits para obter" },
  "No commits to push": { ja: "未プッシュのコミットなし", ko: "푸시할 커밋 없음", fr: "Aucun commit à envoyer", de: "Keine ausstehenden Commits", es: "No hay commits por enviar", pt: "Nenhum commit para enviar" },
  "Push confirmed": { ja: "プッシュを確認済み", ko: "푸시 확인됨", fr: "Envoi confirmé", de: "Push bestätigt", es: "Envío confirmado", pt: "Envio confirmado" },
  "Push not confirmed": { ja: "プッシュ未確認", ko: "푸시 확인 안 됨", fr: "Envoi non confirmé", de: "Push nicht bestätigt", es: "Envío sin confirmar", pt: "Envio não confirmado" },
  "Push succeeded; refresh status": { ja: "プッシュ済み・状態を更新", ko: "푸시됨 · 상태 새로고침", fr: "Envoyé ; actualiser l’état", de: "Gepusht; Status aktualisieren", es: "Enviado; actualizar estado", pt: "Enviado; atualizar status" },
  "Not tracking an upstream": { ja: "上流ブランチ未設定", ko: "업스트림 미설정", fr: "Branche amont non définie", de: "Kein Upstream zugeordnet", es: "Sin rama de seguimiento", pt: "Sem branch de acompanhamento" },
  "Upstream status unavailable": { ja: "上流の状態を確認できません", ko: "업스트림 상태 알 수 없음", fr: "État amont indisponible", de: "Upstream-Status unbekannt", es: "Estado remoto no disponible", pt: "Status upstream indisponível" },
  "Publish branch": { ja: "ブランチを公開", ko: "브랜치 게시", fr: "Publier la branche", de: "Branch veröffentlichen", es: "Publicar rama", pt: "Publicar branch" },
  "Detached HEAD": { ja: "分離 HEAD", ko: "분리된 HEAD", fr: "HEAD détachée", de: "Losgelöster HEAD", es: "HEAD separado", pt: "HEAD separado" },
  "Diverged · ↑{ahead} ↓{behind}": { ja: "分岐 · ↑{ahead} ↓{behind}", ko: "분기됨 · ↑{ahead} ↓{behind}", fr: "Divergence · ↑{ahead} ↓{behind}", de: "Abgewichen · ↑{ahead} ↓{behind}", es: "Divergencia · ↑{ahead} ↓{behind}", pt: "Divergência · ↑{ahead} ↓{behind}" },
  "Compared with the local upstream record; fetch to refresh remote information.": { ja: "ローカルの上流参照と比較しています。リモート情報はフェッチで更新します。", ko: "로컬 업스트림 기록과 비교합니다. 원격 정보는 fetch로 갱신하세요.", fr: "Comparaison avec la référence amont locale ; récupérez les données pour actualiser l’état distant.", de: "Vergleich mit dem lokalen Upstream-Verweis; Fetch aktualisiert die Remote-Informationen.", es: "Comparación con la referencia local de seguimiento; usa fetch para actualizar la información remota.", pt: "Comparação com a referência upstream local; use fetch para atualizar as informações remotas." },
  "Push confirmed, but status refresh failed: {error}": { ja: "プッシュは確認済みですが、状態更新に失敗しました：{error}", ko: "푸시는 확인되었지만 상태 갱신에 실패했습니다: {error}", fr: "Envoi confirmé, mais actualisation impossible : {error}", de: "Push bestätigt, aber Statusaktualisierung fehlgeschlagen: {error}", es: "Envío confirmado, pero no se pudo actualizar el estado: {error}", pt: "Envio confirmado, mas falha ao atualizar o status: {error}" },
} satisfies TranslationCatalog;
