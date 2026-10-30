import type { TranslationCatalog } from "./types";

export const gitTranslations = {
  "Staging file": { ja: "ファイルをステージ中", ko: "파일 스테이징 중", fr: "Indexation du fichier", de: "Datei wird vorgemerkt", es: "Preparando archivo", pt: "Preparando arquivo" },
  "Unstaging file": { ja: "ステージを解除中", ko: "스테이징 취소 중", fr: "Désindexation du fichier", de: "Vormerkung wird aufgehoben", es: "Retirando archivo de preparación", pt: "Retirando arquivo da preparação" },
  "Staging changes": { ja: "変更をステージ中", ko: "변경 사항 스테이징 중", fr: "Indexation des modifications", de: "Änderungen werden vorgemerkt", es: "Preparando cambios", pt: "Preparando alterações" },
  "Creating commit": { ja: "コミットを作成中", ko: "커밋 생성 중", fr: "Création du commit", de: "Commit wird erstellt", es: "Creando commit", pt: "Criando commit" },
  "Creating branch": { ja: "ブランチを作成中", ko: "브랜치 생성 중", fr: "Création de la branche", de: "Branch wird erstellt", es: "Creando rama", pt: "Criando branch" },
  "Switching branch": { ja: "ブランチを切り替え中", ko: "브랜치 전환 중", fr: "Changement de branche", de: "Branch wird gewechselt", es: "Cambiando de rama", pt: "Trocando de branch" },
  "Fetching from remotes": { ja: "リモートから取得中", ko: "원격에서 가져오는 중", fr: "Récupération des dépôts distants", de: "Daten werden von Remotes abgerufen", es: "Obteniendo datos de remotos", pt: "Buscando dados dos remotos" },
  "Pulling changes": { ja: "変更をプル中", ko: "변경 사항 풀 중", fr: "Récupération des modifications", de: "Änderungen werden gepullt", es: "Trayendo cambios", pt: "Puxando alterações" },
  "Pushing changes": { ja: "変更をプッシュ中", ko: "변경 사항 푸시 중", fr: "Envoi des modifications", de: "Änderungen werden gepusht", es: "Enviando cambios", pt: "Enviando alterações" },
  "File staged.": { ja: "ファイルをステージしました。", ko: "파일을 스테이징했습니다.", fr: "Fichier indexé.", de: "Datei vorgemerkt.", es: "Archivo preparado.", pt: "Arquivo preparado." },
  "File unstaged.": { ja: "ステージを解除しました。", ko: "스테이징을 취소했습니다.", fr: "Fichier désindexé.", de: "Vormerkung aufgehoben.", es: "Archivo retirado de preparación.", pt: "Arquivo retirado da preparação." },
  "Changes staged.": { ja: "変更をステージしました。", ko: "변경 사항을 스테이징했습니다.", fr: "Modifications indexées.", de: "Änderungen vorgemerkt.", es: "Cambios preparados.", pt: "Alterações preparadas." },
  "Commit created.": { ja: "コミットを作成しました。", ko: "커밋을 생성했습니다.", fr: "Commit créé.", de: "Commit erstellt.", es: "Commit creado.", pt: "Commit criado." },
  "Branch created and checked out.": { ja: "ブランチを作成し、切り替えました。", ko: "브랜치를 생성하고 전환했습니다.", fr: "Branche créée et activée.", de: "Branch erstellt und ausgecheckt.", es: "Rama creada y activada.", pt: "Branch criada e ativada." },
  "Branch switched.": { ja: "ブランチを切り替えました。", ko: "브랜치를 전환했습니다.", fr: "Branche changée.", de: "Branch gewechselt.", es: "Rama cambiada.", pt: "Branch alterada." },
  "Remote status updated.": { ja: "リモートの状態を更新しました。", ko: "원격 상태를 업데이트했습니다.", fr: "État distant actualisé.", de: "Remote-Status aktualisiert.", es: "Estado remoto actualizado.", pt: "Status remoto atualizado." },
  "Upstream changes pulled.": { ja: "上流の変更を取り込みました。", ko: "업스트림 변경 사항을 가져왔습니다.", fr: "Modifications de la branche amont récupérées.", de: "Upstream-Änderungen gepullt.", es: "Cambios de la rama de seguimiento incorporados.", pt: "Alterações upstream incorporadas." },
  "Branch pushed.": { ja: "ブランチをプッシュしました。", ko: "브랜치를 푸시했습니다.", fr: "Branche envoyée.", de: "Branch gepusht.", es: "Rama enviada.", pt: "Branch enviada." },
  "Another operation is still running.": { ja: "別の操作がまだ実行中です。", ko: "다른 작업이 아직 실행 중입니다.", fr: "Une autre opération est encore en cours.", de: "Eine andere Aktion läuft noch.", es: "Hay otra operación en curso.", pt: "Outra operação ainda está em andamento." },
} satisfies TranslationCatalog;
