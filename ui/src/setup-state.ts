import type {SetupResult} from '@wombat/client';
type RegistrationLabel='setup.chooseProject'|'setup.unchecked'|'setup.trustNeeded'|'setup.registered'|'setup.unwired';

/** Positive readiness requires complete selected-project coverage; observed blockers survive partial reads. */
export function setupRegistrationLabel(project:string|undefined,hooks:SetupResult['hooks']):RegistrationLabel {
  if(!project)return 'setup.chooseProject';
  if(!hooks||hooks.status==='unavailable')return 'setup.unchecked';
  const contexts=hooks.contexts.filter(context=>context.project===project);
  const registrations=contexts.flatMap(context=>context.registrations.filter(item=>item.pluginId?.startsWith('wombat-collection@')));
  if(registrations.some(item=>!item.enabled||(item.trust!=='trusted'&&item.trust!=='managed')))return 'setup.trustNeeded';
  if(hooks.status!=='observed'||!contexts.length||contexts.some(context=>!context.complete))return 'setup.unchecked';
  return registrations.length?'setup.registered':'setup.unwired';
}
