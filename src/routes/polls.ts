import { FastifyInstance } from "fastify";

type PollCreateBody = {
  username: string;
  pollname: string;
  optionslist: string[];
  endat: string;
};

type PollRecord = {
  id: number;
  groupId: number;
  username: string;
  pollname: string;
  optionslist: string[];
  endat: string;
  createdat: string;
  response: {
    username: string;
  };
};

const groupPolls = new Map<number, PollRecord[]>();

let nextPollId = 1;

export async function pollRoutes(app: FastifyInstance) {
  app.post("/api/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);
    const { username, pollname, optionslist, endat } = request.body as PollCreateBody;

    if (!Number.isFinite(groupId)) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    if (
      !username ||
      !pollname ||
      !Array.isArray(optionslist) ||
      optionslist.length < 2 ||
      !endat
    ) {
      return reply.status(400).send({
        error:
          "Invalid payload. Required fields: username, pollname, optionslist (2+ options), endat",
      });
    }

    const endDate = new Date(endat);

    if (Number.isNaN(endDate.getTime())) {
      return reply.status(400).send({ error: "endat must be a valid TIMESTAMPZ value" });
    }

    const poll: PollRecord = {
      id: nextPollId++,
      groupId,
      username,
      pollname,
      optionslist,
      endat: endDate.toISOString(),
      createdat: new Date().toISOString(),
      response: {
        username: "Generic Response",
      },
    };

    const existingPolls = groupPolls.get(groupId) ?? [];
    existingPolls.push(poll);
    groupPolls.set(groupId, existingPolls);

    return reply.status(200).send({
      status: "OK",
      next: `/api/groups/${groupId}/polls`,
      pollId: poll.id,
      results: `/api/polls/${poll.id}/results`,
    });
  });

  app.get("/api/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);

    if (!Number.isFinite(groupId)) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    const polls = groupPolls.get(groupId) ?? [];

    return polls.map((poll) => ({
      username: poll.username,
      pollname: poll.pollname,
      optionslist: poll.optionslist,
      endat: poll.endat,
      results: `/api/polls/${poll.id}/results`,
    }));
  });

  app.get("/api/polls/:pollId/results", async (request, reply) => {
    const pollId = Number((request.params as { pollId: string }).pollId);

    if (!Number.isFinite(pollId)) {
      return reply.status(400).send({ error: "Invalid pollId" });
    }

    for (const polls of groupPolls.values()) {
      const poll = polls.find((entry) => entry.id === pollId);

      if (poll) {
        return {
          pollId: poll.id,
          pollname: poll.pollname,
          response: poll.response,
        };
      }
    }

    return reply.status(404).send({ error: "Poll not found" });
  });
}
