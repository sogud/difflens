import { Image, token } from "nsh";
import addRepository from "../assets/icons/folder-git-2.svg";
import addDirectory from "../assets/icons/folder-plus.svg";
import refresh from "../assets/icons/refresh-cw.svg";
import settings from "../assets/icons/settings-2.svg";
import nested from "../assets/icons/list-tree.svg";
import flat from "../assets/icons/list.svg";
import more from "../assets/icons/ellipsis.svg";
import chevronRight from "../assets/icons/chevron-right.svg";
import chevronDown from "../assets/icons/chevron-down.svg";
import plus from "../assets/icons/plus.svg";
import fetch from "../assets/icons/cloud-download.svg";
import pull from "../assets/icons/arrow-down-to-line.svg";
import push from "../assets/icons/arrow-up-from-line.svg";
import folder from "../assets/icons/folder.svg";
import file from "../assets/icons/file-code-2.svg";
import worktree from "../assets/icons/git-fork.svg";
import stop from "../assets/icons/x.svg";
import rescan from "../assets/icons/folder-search.svg";

// Lucide 0.543.0; license and source details are kept with the SVG assets.
const icons = {
  addRepository, addDirectory, refresh, settings, nested, flat, more,
  chevronRight, chevronDown, plus, fetch, pull, push, folder, file, worktree, stop, rescan,
};

/** Decorative native SVG; the surrounding control owns its accessible label. */
export function Icon(props: {
  name: keyof typeof icons;
  size?: number;
  muted?: boolean;
  spinning?: boolean;
}) {
  return <Image
    src={icons[props.name]}
    accessible={false}
    class={props.spinning ? "animate-spin motion-reduce:animate-none" : ""}
    style={{
      width: props.size ?? 15,
      height: props.size ?? 15,
      flexShrink: 0,
      tintColor: token(props.muted ? "muted-foreground" : "foreground"),
    }}
  />;
}
