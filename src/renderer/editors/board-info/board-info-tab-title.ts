import { englishMessage, t } from "../../../shared/i18n/t";
import { boardIdentity } from "../board/board-identity";

export interface BoardInfoTabTitleState {
    title?: string;
    boardRoot?: string;
    props?: { name?: string };
}

export function formatBoardInfoTabTitle(state: BoardInfoTabTitleState): string | undefined {
    if (state.title === englishMessage("board.infoInstallTitle")) return t("board.infoInstallTitle");
    // Board Info in properties mode is titled with the board's English manifest name.
    if (state.boardRoot && state.props?.name === state.title && state.title) {
        return boardIdentity.displayName(state.boardRoot, state.title);
    }
    return undefined;
}
