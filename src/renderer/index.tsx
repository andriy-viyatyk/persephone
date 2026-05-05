import { AlertsBar, ProgressOverlay } from "./uikit";
import { Dialogs } from "./ui/dialogs/Dialogs";
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
            <ProgressOverlay />
            <AlertsBar />
            <Poppers />
        </>
    );
}

