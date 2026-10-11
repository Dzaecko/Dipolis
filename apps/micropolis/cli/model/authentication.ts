export type ModelAuth = 'api-key' | 'azure-cli';

export const DEFAULT_TOKEN_SCOPE = 'https://ai.azure.com/.default';

export function modelAuth(value: string | undefined): ModelAuth {
	const auth = value?.trim() || 'api-key';
	if (auth !== 'api-key' && auth !== 'azure-cli') {
		throw new Error('CITY_MODEL_AUTH must be api-key or azure-cli');
	}
	return auth;
}

export function tokenScope(value: string | undefined): string {
	const scope = value?.trim() || DEFAULT_TOKEN_SCOPE;
	if (scope !== DEFAULT_TOKEN_SCOPE && scope !== 'https://cognitiveservices.azure.com/.default') {
		throw new Error('CITY_MODEL_TOKEN_SCOPE must be https://ai.azure.com/.default or https://cognitiveservices.azure.com/.default');
	}
	return scope;
}
