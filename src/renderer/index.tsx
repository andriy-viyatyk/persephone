import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AlertsBar } from "./ui/dialogs/alerts/AlertsBar";
import { Dialogs } from "./ui/dialogs/Dialogs";
import { Poppers } from "./ui/dialogs/poppers/Poppers";
import { MainPage } from "./app/MainPage";
import "./setup/configure-monaco";
import "./editors/register-editors";
import { GlobalStyles } from "./theme/GlobalStyles";

export default function AppContent() {
    return (
        <DndProvider backend={HTML5Backend}>
            <GlobalStyles />
            <MainPage />
            <Dialogs />
            <AlertsBar />
            <Poppers />
        </DndProvider>
    );
}

