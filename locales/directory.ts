import type { TranslationCatalog } from "./types";

export const directoryChinese = {
  "Current repository": "当前仓库",
  "Current directory": "当前目录",
  "All repositories in this directory": "当前目录的全部仓库",
  "{repositories} repositories · {files} changed files": "{repositories} 个仓库 · {files} 个更改文件",
  "Open repository for commit and push": "打开此仓库进行提交与推送",
  "Refresh expanded repositories": "刷新已展开的仓库",
  "Repository discovery is still running.": "目录仍在扫描，仓库列表尚未完整。",
  "{count} directories could not be fully scanned.": "{count} 个目录未能完整扫描。",
  "Showing {count} files. Open the repository to see all {total}.": "已显示 {count} 个文件，打开此仓库查看全部 {total} 个。",
  "Some repository statuses are unavailable; file totals are incomplete.": "部分仓库状态不可用，文件总数不完整。",
  "No repositories found.": "没有发现仓库。",
} as const;

export const directoryTranslations = {
  "Current repository": { ja: "現在のリポジトリ", ko: "현재 저장소", fr: "Dépôt actuel", de: "Aktuelles Repository", es: "Repositorio actual", pt: "Repositório atual" },
  "Current directory": { ja: "現在のディレクトリ", ko: "현재 디렉터리", fr: "Dossier actuel", de: "Aktuelles Verzeichnis", es: "Directorio actual", pt: "Diretório atual" },
  "All repositories in this directory": { ja: "このディレクトリ内の全リポジトリ", ko: "이 디렉터리의 모든 저장소", fr: "Tous les dépôts de ce dossier", de: "Alle Repositories in diesem Verzeichnis", es: "Todos los repositorios de este directorio", pt: "Todos os repositórios deste diretório" },
  "{repositories} repositories · {files} changed files": { ja: "{repositories} リポジトリ · {files} 変更ファイル", ko: "저장소 {repositories}개 · 변경 파일 {files}개", fr: "{repositories} dépôts · {files} fichiers modifiés", de: "{repositories} Repositories · {files} geänderte Dateien", es: "{repositories} repositorios · {files} archivos modificados", pt: "{repositories} repositórios · {files} arquivos alterados" },
  "Open repository for commit and push": { ja: "コミットとプッシュのためリポジトリを開く", ko: "커밋 및 푸시를 위해 저장소 열기", fr: "Ouvrir ce dépôt pour committer et envoyer", de: "Repository zum Committen und Pushen öffnen", es: "Abrir este repositorio para commit y push", pt: "Abrir este repositório para commit e push" },
  "Refresh expanded repositories": { ja: "展開中のリポジトリを更新", ko: "펼친 저장소 새로고침", fr: "Actualiser les dépôts dépliés", de: "Aufgeklappte Repositories aktualisieren", es: "Actualizar repositorios expandidos", pt: "Atualizar repositórios expandidos" },
  "Repository discovery is still running.": { ja: "探索中のため、一覧はまだ不完全です。", ko: "검색 중이므로 저장소 목록이 아직 완전하지 않습니다.", fr: "La recherche est en cours ; la liste reste incomplète.", de: "Die Suche läuft; die Liste ist noch unvollständig.", es: "La búsqueda continúa; la lista aún no está completa.", pt: "A busca continua; a lista ainda não está completa." },
  "{count} directories could not be fully scanned.": { ja: "{count} ディレクトリを完全には走査できませんでした。", ko: "디렉터리 {count}개를 완전히 검색하지 못했습니다.", fr: "{count} dossiers n’ont pas pu être entièrement examinés.", de: "{count} Verzeichnisse konnten nicht vollständig durchsucht werden.", es: "No se pudieron examinar completamente {count} directorios.", pt: "Não foi possível examinar completamente {count} diretórios." },
  "Showing {count} files. Open the repository to see all {total}.": { ja: "{count} ファイルを表示中。全 {total} 件はリポジトリを開いて確認してください。", ko: "파일 {count}개 표시 중. 전체 {total}개는 저장소를 열어 확인하세요.", fr: "{count} fichiers affichés. Ouvrez le dépôt pour voir les {total} fichiers.", de: "{count} Dateien angezeigt. Öffnen Sie das Repository für alle {total} Dateien.", es: "Se muestran {count} archivos. Abre el repositorio para ver los {total}.", pt: "Exibindo {count} arquivos. Abra o repositório para ver todos os {total}." },
  "Some repository statuses are unavailable; file totals are incomplete.": { ja: "一部の状態を取得できないため、合計は不完全です。", ko: "일부 저장소 상태를 읽지 못해 파일 합계가 불완전합니다.", fr: "Certains états sont indisponibles ; le total des fichiers est incomplet.", de: "Einige Repository-Status sind unbekannt; die Dateisumme ist unvollständig.", es: "Algunos estados no están disponibles; el total de archivos está incompleto.", pt: "Alguns status estão indisponíveis; o total de arquivos está incompleto." },
  "No repositories found.": { ja: "リポジトリが見つかりません。", ko: "저장소를 찾지 못했습니다.", fr: "Aucun dépôt trouvé.", de: "Keine Repositories gefunden.", es: "No se encontraron repositorios.", pt: "Nenhum repositório encontrado." },
} satisfies TranslationCatalog;
