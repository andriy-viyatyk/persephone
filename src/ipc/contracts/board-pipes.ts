

export interface BoardPipesApi {
    registerBoardPipePage: (
        pageId: string,
        host?: string,
        boardRoot?: string,
        hostedDocument?: boolean,
    ) => Promise<void>;
    unregisterBoardPipePage: (pageId: string) => Promise<void>;
    registerBoardPipeResource: (
        resourceId: string,
        host: string,
        boardRoot?: string,
        filePath?: string,
    ) => Promise<void>;
    unregisterBoardPipeResource: (resourceId: string) => Promise<void>;
}

