import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { app } from "./renderer/api/app";

function RootComponent() {
    const [content, setContent] = useState(null);

    useEffect(() => {
        const bootstrap = async () => {
            const [cont] = await Promise.all([
                import("./renderer/index"),  // load main bundle (stores init here)
                app.init(),                  // init app version (IPC call)
            ]);
            await app.initServices();        // load interface wrappers (stores already cached)
            await app.initPages();           // restore persisted pages
            await app.initEvents();          // subscribe to all events (global, keyboard, IPC)
            setContent(<cont.default />);
        };
        bootstrap();
    }, []);

    return content;
}

const container = document.getElementById("root");
if (container) {
    const root = createRoot(container);
    root.render(<RootComponent />);
}