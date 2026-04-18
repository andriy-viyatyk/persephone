import { AlertsBar } from "./ui/dialogs/alerts/AlertsBar";
import { Dialogs } from "./ui/dialogs/Dialogs";
import { Progress } from "./ui/dialogs/progress/Progress";
import { Poppers } from "./ui/dialogs/poppers/Poppers";
import { MainPage } from "./ui/app/MainPage";
import "./editors/register-editors";
import { GlobalStyles } from "./theme/GlobalStyles";

export default function AppContent() {
    return (
        <>
            <GlobalStyles />
            <MainPage />
            <Dialogs />
            <Progress />
            <AlertsBar />
            <Poppers />
        </>
    );
}

