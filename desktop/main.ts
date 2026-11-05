import { app, BrowserWindow, Menu, dialog, protocol, session, shell } from "electron";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const APP_SCHEME = "pokebonk";
const APP_HOST = "game";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const MIME_TYPES = new Map([
  [".glb", "model/gltf-binary"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

if (!app.isPackaged && process.env['POKEBONK_REMOTE_DEBUGGING_PORT']) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env['POKEBONK_REMOTE_DEBUGGING_PORT']);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      corsEnabled: true,
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

function getGameDirectory() {
  if (!app.isPackaged && process.env['POKEBONK_GAME_DIR']) {
    return path.resolve(process.env['POKEBONK_GAME_DIR']);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "game");
  }
  return path.join(moduleDirectory, "game");
}

function resolveGamePath(requestUrl: string) {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) {
    return undefined;
  }

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "").replace(/^assets\/assets\//, "assets/");
  const gameDirectory = getGameDirectory();
  const resolvedPath = path.resolve(gameDirectory, relativePath);
  if (resolvedPath !== gameDirectory && !resolvedPath.startsWith(`${gameDirectory}${path.sep}`)) {
    return undefined;
  }
  return resolvedPath;
}

function configureOfflineSession() {
  const appSession = session.defaultSession;
  // The upstream game owns pointer-lock and fullscreen timing. Grant only its
  // main frame these capabilities; other permissions remain denied by default.
  const isGameUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
        && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  appSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    (permission === "pointerLock" || permission === "fullscreen") && details.isMainFrame
    && contents !== null && isGameUrl(contents.getURL()) && isGameUrl(origin));
  appSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback((permission === "pointerLock" || permission === "fullscreen") && details.isMainFrame
      && isGameUrl(contents.getURL()) && isGameUrl(details.requestingUrl));
  });
  appSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
}

function parseRange(rangeHeader: string | null, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match || (!match[1] && !match[2])) return undefined;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return undefined;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2] ?? "", 10) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

function serveGameFile(request: Request, resolvedPath: string) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }

  const fileStat = statSync(resolvedPath);
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, fileStat.size) : undefined;
  if (rangeHeader && !range) {
    return new Response(null, {
      headers: { "Content-Range": `bytes */${fileStat.size}` },
      status: 416,
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? fileStat.size - 1;
  const headers: Record<string,string> = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": String(Math.max(end - start + 1, 0)),
    "Content-Type": MIME_TYPES.get(path.extname(resolvedPath).toLowerCase()) ?? "application/octet-stream",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${fileStat.size}`;

  // Node creates a WHATWG stream of file bytes; Electron consumes the same
  // stream contract, while Node and DOM declare different stream types.
  const body = request.method === "HEAD" || fileStat.size === 0
    ? null
    : Readable.toWeb(createReadStream(resolvedPath, { start, end })) as ReadableStream<Uint8Array>;
  const response = new Response(body, {
    headers,
    status: range ? 206 : 200,
  });
  return response;
}

function toggleFullscreen(window: BrowserWindow) {
  // Keep shell shortcuts on the same HTML API as the game's controls. A window
  // put into native fullscreen by macOS can still be exited with this shortcut.
  void window.webContents.executeJavaScript(`(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    if (${window.isFullScreen()}) return true;
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return false;
  })()`, true).then((exitNative: unknown) => {
    if (exitNative === true && !window.isDestroyed()) window.setFullScreen(false);
  }).catch(error => console.error("Failed to toggle fullscreen", error));
}

function configureApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { role: "close" },
        ...(process.platform === "darwin" ? [] : [{ role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{
        id: "fullscreen",
        label: "Toggle Full Screen",
        accelerator: process.platform === "darwin" ? "Control+Command+F" : "F11",
        click: (_item, window) => { if (window instanceof BrowserWindow) toggleFullscreen(window); },
      }],
    },
    { role: "windowMenu" },
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: "#000000",
    icon: path.join(getGameDirectory(), "icons/icon-512.png"),
    show: false,
    autoHideMenuBar: true,
    title: app.getName(),
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const openExternal = (value: string) => {
    let url;
    try { url = new URL(value); } catch { return; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    void shell.openExternal(url.href).catch(error => {
      console.error("Failed to open external link", error);
      if (!window.isDestroyed()) void dialog.showMessageBox(window, {
        type: "error",
        message: "The link could not be opened in your default browser.",
      });
    });
  };
  window.webContents.setWindowOpenHandler(({url}) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", event => {
    const target = new URL(event.url);
    if (target.protocol !== `${APP_SCHEME}:` || target.host !== APP_HOST) {
      event.preventDefault();
      openExternal(event.url);
    }
  });
  window.webContents.on("will-prevent-unload", event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      buttons: ["Keep Playing", "Close Game"],
      defaultId: 0,
      cancelId: 0,
      title: "Close PokéBonk?",
      message: "Close the current game?",
      detail: "The current run will end without being completed. Previously saved progress and settings will be kept.",
      noLink: true,
    });
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      if (!input.isAutoRepeat) toggleFullscreen(window);
    }
  });
  window.once("ready-to-show", () => window.show());
  // Upstream pauses a playing run when a touch layout is hidden, or when pointer
  // lock ends after it has been held. A minimized desktop window often does neither
  // (Linux compositors keep the document visible, and a fresh lock counts as a flicker).
  window.on("minimize", () => {
    if (window.isDestroyed()) return;
    void window.webContents.executeJavaScript(`(() => {
      const run = window.__pokebonkLocalApp?.run;
      if (run?.state === "play") run.pause();
    })()`, true).catch(error => console.error("Failed to pause minimized run", error));
  });
  void window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
  return window;
}

if (process.env['POKEBONK_USER_DATA_DIR']) app.setPath("userData", path.resolve(process.env['POKEBONK_USER_DATA_DIR']));

void app.whenReady().then(() => {
  const gameDirectory = getGameDirectory();
  if (!existsSync(path.join(gameDirectory, "index.html"))) {
    throw new Error(`Packaged game is missing index.html: ${gameDirectory}`);
  }

  session.defaultSession.protocol.handle(APP_SCHEME, request => {
    const resolvedPath = resolveGamePath(request.url);
    if (!resolvedPath || !existsSync(resolvedPath)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      return serveGameFile(request, resolvedPath);
    } catch (error) {
      console.error(`Failed to serve ${resolvedPath}`, error);
      return new Response("Failed to read packaged game resource", {
        status: 500,
      });
    }
  });

  configureOfflineSession();
  configureApplicationMenu();
  createWindow();
}).catch(error => {
  console.error(error);
  app.exit(1);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
