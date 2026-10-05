import { operations } from '@crossfire/contracts/rest/operations';
import { createPublication } from '@crossfire/domain/publication/create';
import { readPublication, readPublications } from '@crossfire/domain/publication/read';
import { uploadPublicationFile } from '@crossfire/domain/publication/upload';
import { commitPublication } from '@crossfire/domain/publication/commit';
import { deletePublication } from '@crossfire/domain/publication/delete';
import { bind, actor, reply, paged } from '../bind.js';
export function publicationRoutes() {
  return [
    bind(operations.createPublication, (context, _params, _query, input) => reply(createPublication(context.services, actor(context), input, context.requestId))),
    bind(operations.publications, (context, _params, query) => paged(readPublications(context.services, actor(context), query))),
    bind(operations.publication, (context, params) => reply(readPublication(context.services, actor(context), params.publicationId))),
    bind(operations.uploadPublicationFile, async (context, params, _query, input) => reply(await uploadPublicationFile(context.services, actor(context),
      params.publicationId, params.fileId, input, context.signal))),
    bind(operations.commitPublication, async (context, params, _query, input) => reply(await commitPublication(context.services, actor(context),
      params.publicationId, input.expectedRevision, context.requestId))),
    bind(operations.deletePublication, async (context, params, _query, input) => reply(await deletePublication(context.services, actor(context),
      params.publicationId, input.expectedRevision, context.requestId))),
  ];
}
