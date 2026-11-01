import { setGenerationAuthorization } from '../src/shared/generation-authorization';

// Provider-focused unit tests are not license tests; set their fixture gate explicitly.
setGenerationAuthorization(async () => undefined);
