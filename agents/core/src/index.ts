/**
 * @agents/core — shared platform library.
 *
 * Connectors, registries, and the repo manager land in subsequent commits.
 */

export * as schema from "./db/schema.js";
export { getDb, closeDb, type Db } from "./db/client.js";
export { runMigrations } from "./db/migrate.js";

export {
  getSecrets,
  setSecrets,
  getByRef,
  keytarAdapter,
  buildKeytarRef,
  parseKeytarRef,
  MalformedKeychainRefError,
  UnknownBackendError,
  type SecretsAdapter,
} from "./secrets/index.js";

export {
  ensureRepo,
  ensureWorktree,
  logPrActivity,
  type EnsureRepoArgs,
  type EnsureWorktreeArgs,
  type LogPrActivityArgs,
  type PrActivityKind,
  type PrActivityStatus,
  type Repo,
  type Worktree,
  type PrActivity,
} from "./repos/manager.js";

export {
  addConnector,
  getActiveConnector,
  getConnector,
  listConnectors,
  readSecret,
  removeConnector,
  testConnector,
  type AddConnectorArgs,
  type ConnectorRow,
  type JiraConfig,
  type TestResult,
} from "./connectors/manager.js";

export {
  addMcpServer,
  getMcpServerByName,
  listMcpServers,
  removeMcpServer,
  testMcpServer,
  type AddMcpServerArgs,
  type HttpConfig,
  type McpConfig,
  type McpServerRow,
  type McpTestResult,
  type McpTool,
  type McpTransport,
  type SseConfig,
  type StdioConfig,
} from "./mcp/manager.js";

export {
  addChannel,
  dispatchEvent,
  getChannel,
  listChannels,
  listDeliveries,
  listSenders,
  listSubscriptions,
  registerSender,
  removeChannel,
  removeSubscription,
  setSubscription,
  type AddChannelArgs,
  type DispatchArgs,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationEvent,
  type NotificationSubscription,
  type SenderFn,
} from "./notifications/index.js";

export {
  approveAction,
  enqueueAction,
  executePendingAction,
  getPendingAction,
  listExecutors,
  listPendingActions,
  registerExecutor,
  rejectAction,
  type EnqueueActionArgs,
  type ExecutorFn,
  type ListPendingArgs,
  type PendingAction,
  type PendingActionStatus,
} from "./approvals/index.js";

export {
  deleteUserContext,
  getUserContext,
  setUserContext,
  type UserContext,
} from "./user-context/index.js";

export {
  createTask,
  getTask,
  listTasks,
  materializeTaskWorkspace,
  removeTask,
  setTaskStatus,
  type CreateTaskArgs,
  type Task,
  type TaskWithRepos,
} from "./tasks/index.js";

export {
  cloneTemplate,
  getTemplateBySlug,
  listTemplates,
  seedDefaultTemplates,
  type AgentTemplate,
  type CloneTemplateArgs,
  type TemplateSeed,
} from "./templates/index.js";

export {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  verifyApiToken,
  type ApiToken,
  type CreateTokenArgs,
  type CreateTokenResult,
} from "./auth/tokens.js";

export {
  bootstrapDefaultUser,
  countUsers,
  createSession,
  createUser,
  deleteSession,
  getUserByEmail,
  getUserById,
  hashPassword,
  pruneExpiredSessions,
  validateSession,
  verifyPassword,
  type AuthSession,
  type CreateUserArgs,
  type User,
} from "./auth/index.js";
