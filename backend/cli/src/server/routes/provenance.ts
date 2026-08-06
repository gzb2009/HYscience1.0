import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Provenance } from "../../science/provenance/store"
import { lazy } from "../../util/lazy"

export const ProvenanceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List provenance nodes",
        description: "List all nodes in the local provenance DAG, optionally filtered by path.",
        operationId: "provenance.list",
        responses: {
          200: {
            description: "Provenance nodes",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    nodes: z.array(z.any()),
                    count: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string().optional(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const nodes = await Provenance.list()
        const filtered = path
          ? nodes.filter((n) => {
              const p = typeof (n as { path?: string }).path === "string" ? (n as { path?: string }).path : undefined
              if (!p) return false
              return p === path || p.endsWith("/" + path) || p.endsWith(path)
            })
          : nodes
        return c.json({ nodes: filtered, count: filtered.length })
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Query provenance lineage",
        description: "Return a provenance node and its connected lineage.",
        operationId: "provenance.query",
        responses: {
          200: {
            description: "Lineage",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    nodes: z.array(z.any()),
                    edges: z.array(z.any()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        return c.json(await Provenance.query(id))
      },
    ),
)
