import type { TranslationCatalog } from "./types";

export const updateTranslations = {
  "Check for Updates…": {
    ja: "アップデートを確認…", ko: "업데이트 확인…", fr: "Rechercher les mises à jour…",
    de: "Nach Updates suchen…", es: "Buscar actualizaciones…", pt: "Verificar atualizações…",
  },
  "Check for updates": {
    ja: "アップデートを確認", ko: "업데이트 확인", fr: "Rechercher les mises à jour",
    de: "Nach Updates suchen", es: "Buscar actualizaciones", pt: "Verificar atualizações",
  },
  "Checking for updates…": {
    ja: "アップデートを確認中…", ko: "업데이트 확인 중…", fr: "Recherche des mises à jour…",
    de: "Suche nach Updates…", es: "Buscando actualizaciones…", pt: "Verificando atualizações…",
  },
  "Updates": {
    ja: "アップデート", ko: "업데이트", fr: "Mises à jour",
    de: "Updates", es: "Actualizaciones", pt: "Atualizações",
  },
  "Current version": {
    ja: "現在のバージョン", ko: "현재 버전", fr: "Version actuelle",
    de: "Aktuelle Version", es: "Versión actual", pt: "Versão atual",
  },
  "Channel": {
    ja: "チャンネル", ko: "채널", fr: "Canal",
    de: "Kanal", es: "Canal", pt: "Canal",
  },
  "Beta": {
    ja: "ベータ", ko: "베타", fr: "Bêta",
    de: "Beta", es: "Beta", pt: "Beta",
  },
  "Automatically check for updates": {
    ja: "アップデートを自動的に確認", ko: "업데이트 자동 확인",
    fr: "Rechercher automatiquement les mises à jour", de: "Automatisch nach Updates suchen",
    es: "Buscar actualizaciones automáticamente", pt: "Verificar atualizações automaticamente",
  },
  "Version {version} (build {build}) is available.": {
    ja: "バージョン {version}（ビルド {build}）が利用可能です。",
    ko: "버전 {version}(빌드 {build})을 사용할 수 있습니다.",
    fr: "La version {version} (build {build}) est disponible.",
    de: "Version {version} (Build {build}) ist verfügbar.",
    es: "La versión {version} (compilación {build}) está disponible.",
    pt: "A versão {version} (build {build}) está disponível.",
  },
  "Download update": {
    ja: "アップデートをダウンロード", ko: "업데이트 다운로드", fr: "Télécharger la mise à jour",
    de: "Update herunterladen", es: "Descargar actualización", pt: "Baixar atualização",
  },
  "Downloading update…": {
    ja: "アップデートをダウンロード中…", ko: "업데이트 다운로드 중…",
    fr: "Téléchargement de la mise à jour…", de: "Update wird heruntergeladen…",
    es: "Descargando actualización…", pt: "Baixando atualização…",
  },
  "Download progress": {
    ja: "ダウンロードの進行状況", ko: "다운로드 진행률", fr: "Progression du téléchargement",
    de: "Download-Fortschritt", es: "Progreso de descarga", pt: "Progresso do download",
  },
  "Update ready": {
    ja: "アップデートの準備完了", ko: "업데이트 준비됨", fr: "Mise à jour prête",
    de: "Update bereit", es: "Actualización lista", pt: "Atualização pronta",
  },
  "Restart and install": {
    ja: "再起動してインストール", ko: "재시작 및 설치", fr: "Redémarrer et installer",
    de: "Neu starten und installieren", es: "Reiniciar e instalar", pt: "Reiniciar e instalar",
  },
  "DiffLens will close and reopen to finish installing the update.": {
    ja: "アップデートのインストールを完了するため、DiffLens は終了して再起動します。",
    ko: "업데이트 설치를 마치기 위해 DiffLens가 종료되었다가 다시 열립니다.",
    fr: "DiffLens va se fermer et se rouvrir pour terminer l’installation.",
    de: "DiffLens wird geschlossen und neu geöffnet, um das Update abzuschließen.",
    es: "DiffLens se cerrará y volverá a abrir para terminar la instalación.",
    pt: "O DiffLens será fechado e reaberto para concluir a instalação.",
  },
  "Installing update…": {
    ja: "アップデートをインストール中…", ko: "업데이트 설치 중…",
    fr: "Installation de la mise à jour…", de: "Update wird installiert…",
    es: "Instalando actualización…", pt: "Instalando atualização…",
  },
  "Update failed: {error}": {
    ja: "アップデートに失敗しました：{error}", ko: "업데이트 실패: {error}",
    fr: "Échec de la mise à jour : {error}", de: "Update fehlgeschlagen: {error}",
    es: "Error de actualización: {error}", pt: "Falha na atualização: {error}",
  },
  "Private Beta updates require the GitHub CLI to be signed in with access to this repository.": {
    ja: "プライベートベータのアップデートには、このリポジトリへのアクセス権を持つ GitHub CLI へのサインインが必要です。",
    ko: "비공개 베타 업데이트를 사용하려면 이 저장소에 접근 권한이 있는 GitHub CLI에 로그인해야 합니다.",
    fr: "Les mises à jour de la bêta privée nécessitent une connexion au GitHub CLI avec accès à ce dépôt.",
    de: "Updates der privaten Beta erfordern eine Anmeldung bei der GitHub CLI mit Zugriff auf dieses Repository.",
    es: "Las actualizaciones de la beta privada requieren iniciar sesión en GitHub CLI con acceso a este repositorio.",
    pt: "As atualizações da beta privada exigem login no GitHub CLI com acesso a este repositório.",
  },
  "Open release page": {
    ja: "リリースページを開く", ko: "릴리스 페이지 열기", fr: "Ouvrir la page de la version",
    de: "Release-Seite öffnen", es: "Abrir página de la versión", pt: "Abrir página da versão",
  },
  "Could not install the update: {error}": {
    ja: "アップデートをインストールできませんでした：{error}",
    ko: "업데이트를 설치하지 못했습니다: {error}",
    fr: "Impossible d’installer la mise à jour : {error}",
    de: "Update konnte nicht installiert werden: {error}",
    es: "No se pudo instalar la actualización: {error}",
    pt: "Não foi possível instalar a atualização: {error}",
  },
  "Finish the current Git operation or scan before installing the update.": {
    ja: "アップデートをインストールする前に、実行中の Git 操作またはスキャンを完了してください。",
    ko: "업데이트를 설치하기 전에 진행 중인 Git 작업 또는 검색을 완료하세요.",
    fr: "Terminez l’opération Git ou l’analyse en cours avant d’installer la mise à jour.",
    de: "Beenden Sie den laufenden Git-Vorgang bzw. Scan, bevor Sie das Update installieren.",
    es: "Termina la operación de Git o el escaneo en curso antes de instalar la actualización.",
    pt: "Conclua a operação Git ou a verificação em andamento antes de instalar a atualização.",
  },
  "Automatic updates are not available in this build.": {
    ja: "このビルドでは自動アップデートを利用できません。",
    ko: "이 빌드에서는 자동 업데이트를 사용할 수 없습니다.",
    fr: "Les mises à jour automatiques ne sont pas disponibles dans cette version.",
    de: "Automatische Updates sind in diesem Build nicht verfügbar.",
    es: "Las actualizaciones automáticas no están disponibles en esta compilación.",
    pt: "Atualizações automáticas não estão disponíveis nesta compilação.",
  },
  "Update available": {
    ja: "アップデートがあります", ko: "업데이트 사용 가능", fr: "Mise à jour disponible",
    de: "Update verfügbar", es: "Actualización disponible", pt: "Atualização disponível",
  },
} satisfies TranslationCatalog;
