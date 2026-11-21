import { registerAppRoutes } from "./app.ts";
import { registerAdminRoutes } from "./admin.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerChatRoutes } from "./chats.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerMessageRoutes } from "./messages.ts";
import { registerPushRoutes } from "./push.ts";
import { registerPresenceRoutes } from "./presence.ts";
import { registerProfileRoutes } from "./profile.ts";
import { registerRemoteChannelRoutes } from "./remoteChannels.ts";
import { registerCallRoutes } from "./calls.ts";
import { registerRemoteChannelTickRoutes } from "./remoteChannelTick.ts";
import { registerRemoteMirrorRoutes } from "./remoteMirror.ts";
import { registerAdminPanelRoutes } from "./adminPanel.ts";
import { registerDepartmentRoutes } from "./departments.ts";
import { registerAdminRemoteChannelRoutes } from "./adminRemoteChannel.ts";
import { registerRemoteUploadRoutes } from "./uploadsRemote.ts";

function registerApiRoutes(app, deps) {
  registerHealthRoutes(app, deps);
  registerAppRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerPresenceRoutes(app, deps);
  registerProfileRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerRemoteChannelRoutes(app, deps);
  registerRemoteChannelTickRoutes(app, deps);
  registerRemoteMirrorRoutes(app, deps);
  registerMessageRoutes(app, deps);
  registerRemoteUploadRoutes(app, deps);
  registerPushRoutes(app, deps);
  registerCallRoutes(app, deps);
  registerAdminPanelRoutes(app, deps);
  registerDepartmentRoutes(app, deps);
  registerAdminRemoteChannelRoutes(app, deps);
  registerAdminRoutes(app, deps);
}

export { registerApiRoutes };
