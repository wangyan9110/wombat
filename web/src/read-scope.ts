import { CoreError, type QueryOptions, type UsageClient, type UsageRequest } from '@wombat/client';

export function createWebReadScope(
  client: UsageClient,
  initialRoots?: string[],
  initialProjects?: string[],
) {
  const snapshots = new Set<string>();
  const configViews = new Set<string>();
  const snapshotSources = new Map<string, Set<string>>();
  const authorizedSources = new Set<string>();
  let authorizedSourcesComplete = false;
  const incompleteSnapshotSources = new Set<string>();
  const startupRoots = initialRoots ? [...initialRoots] : undefined;
  let roots = startupRoots ? [...startupRoots] : undefined;
  const startupProjects = [...(initialProjects ?? [])];
  let grantedProjects = [...startupProjects];
  const observedProjects = new Set(startupProjects);
  const observeProjects = (result: import('@wombat/client').UsageResult) => {
    for (const project of result.facets?.directories ?? []) observedProjects.add(project);
    for (const source of result.quality.sources) authorizedSources.add(source.source.id);
    if (!result.quality.detailSummary?.omittedSources) authorizedSourcesComplete = true;
  };
  let projectDiscovery: Promise<void> | undefined;
  const discoverProject = async (project: string | null | undefined, query: QueryOptions) => {
    if (!project || observedProjects.has(project)) return;
    projectDiscovery ??= (async () => {
      if (client.live) {
        const result = await client.live(
          {
            query: { action: 'usage', roots: roots, scope: { allTime: true }, limit: 1 },
            mode: 'fresh',
          },
          query,
        );
        observeProjects(result.result);
      } else {
        observeProjects(
          await client.query(
            {
              action: 'usage',
              roots: roots,
              scope: { allTime: true },
              limit: 1,
            },
            query,
          ),
        );
      }
    })().finally(() => {
      projectDiscovery = undefined;
    });
    await projectDiscovery;
    if (!observedProjects.has(project) && !(grantedProjects ?? []).includes(project))
      throw new CoreError('PROJECT_NOT_AUTHORIZED', 'Project is outside the current read scope');
  };
  const projectRoots = (project?: string | null) => [
    ...new Set([
      ...(grantedProjects ?? []),
      ...(project && observedProjects.has(project) ? [project] : []),
    ]),
  ];
  let grantFingerprint = '';
  const updateGrants = (result: import('@wombat/client').DirectoriesResult) => {
    const fingerprint = JSON.stringify(
      result.grants.map((g) => [g.id, g.directoryIdentity, g.path, g.purpose, g.status]),
    );
    if (fingerprint === grantFingerprint) return;
    grantFingerprint = fingerprint;
    const grants = result.grants.filter((g) => g.status === 'authorized');
    grantedProjects = [
      ...new Set([
        ...startupProjects,
        ...grants.filter((g) => g.purpose === 'project').map((g) => g.path),
      ]),
    ];
    roots = startupRoots
      ? [
          ...new Set([
            ...startupRoots,
            ...grants.filter((g) => g.purpose === 'source').map((g) => g.path),
          ]),
        ]
      : undefined;
    configViews.clear();
    snapshots.clear();
    snapshotSources.clear();
    authorizedSources.clear();
    incompleteSnapshotSources.clear();
    authorizedSourcesComplete = false;
    observedProjects.clear();
    for (const project of grantedProjects ?? []) observedProjects.add(project);
  };
  const scope = (request: UsageRequest): UsageRequest => {
    // Paths and fixed snapshots can select data outside this host's startup scope.
    if (request.roots != null || (request.snapshotId != null && !snapshots.has(request.snapshotId)))
      throw new CoreError('INVALID_ARGUMENT', 'Web scope is fixed at startup');
    return {
      ...request,
      roots: request.snapshotId && !request.snapshotId.startsWith('live:') ? undefined : roots,
    };
  };
  const revalidateFixed = async (query: import('@wombat/client').QueryOptions) => {
    if (client.directories) updateGrants(await client.directories({ action: 'list' }, query));
  };
  return {
    snapshots,
    configViews,
    snapshotSources,
    authorizedSources,
    incompleteSnapshotSources,
    observeProjects,
    discoverProject,
    projectRoots,
    updateGrants,
    scope,
    revalidateFixed,
    hasProject: (project: string) => observedProjects.has(project),
    get roots() {
      return roots ? [...roots] : undefined;
    },
    get configuredProjects() {
      return [...grantedProjects];
    },
    get sourcesComplete() {
      return authorizedSourcesComplete;
    },
    initialize: async () => {
      if (client.directories) {
        try {
          updateGrants(await client.directories({ action: 'list' }));
        } catch {
          /* Keep the startup scope; the directory panel reports the failed registry. */
        }
      }
    },
  };
}
export type WebReadScope = ReturnType<typeof createWebReadScope>;
