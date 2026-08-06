import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await Ripgrep.search({
          cwd: Instance.directory,
          pattern,
          limit: 10,
        })
        return c.json(result)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await File.search({
          query,
          limit: limit ?? 10,
          dirs: dirs !== "false",
          type,
        })
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        /*
      const query = c.req.valid("query").query
      const result = await LSP.workspaceSymbol(query)
      return c.json(result)
      */
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.list(path)
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.read(path)
        return c.json(content)
      },
    )
    .put(
      "/file/content",
      describeRoute({
        summary: "Write file",
        description: "Write the content of a specified file.",
        operationId: "file.write",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
          encoding: z.literal("base64").optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const content = await File.write(
          body.path,
          body.content,
          body.encoding ? { encoding: body.encoding } : undefined,
        )
        return c.json(content)
      },
    )
    .post(
      "/file/directory/ensure",
      describeRoute({
        summary: "Ensure directory",
        description: "Create a directory inside the current project if it does not exist.",
        operationId: "file.ensureDirectory",
        responses: {
          200: {
            description: "Directory path",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await File.ensureDirectory(body.path))
      },
    )
    .post(
      "/file/directory/migrate",
      describeRoute({
        summary: "Migrate directory",
        description: "Move the contents of one project directory into another and remove the old directory.",
        operationId: "file.migrateDirectory",
        responses: {
          200: {
            description: "Migration result",
            content: {
              "application/json": {
                schema: resolver(z.object({ migrated: z.boolean() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          from: z.string(),
          to: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await File.migrateDirectory(body))
      },
    )
    .post(
      "/file/delete",
      describeRoute({
        summary: "Delete file",
        description: "Delete a file inside the current project directory.",
        operationId: "file.delete",
        responses: {
          200: {
            description: "Delete result",
            content: {
              "application/json": {
                schema: resolver(z.object({ deleted: z.boolean() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await File.remove(body.path))
      },
    )
    .post(
      "/file/open",
      describeRoute({
        summary: "Open local file",
        description: "Reveal a project file in the OS file manager, or open it with the default / preferred app.",
        operationId: "file.open",
        responses: {
          200: {
            description: "Open result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    opened: z.boolean(),
                    action: z.enum(["reveal", "app"]),
                    path: z.string(),
                    app: z.enum(["excel", "default"]).optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          action: z.enum(["reveal", "app"]),
          app: z.enum(["excel", "default"]).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await File.openLocal(body))
      },
    )
    .post(
      "/file/rename",
      describeRoute({
        summary: "Rename file",
        description: "Rename a file inside the current project directory.",
        operationId: "file.rename",
        responses: {
          200: {
            description: "Rename result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    renamed: z.boolean(),
                    from: z.string(),
                    to: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          from: z.string(),
          to: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await File.rename(body))
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await File.status()
        return c.json(content)
      },
    ),
)
