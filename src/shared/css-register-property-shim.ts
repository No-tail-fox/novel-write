/**
 * AI-authored scene code may call CSS.registerProperty on every (re)mount or seek. Registering
 * the same name twice in one document throws InvalidModificationError, which used to break the
 * old template motion preview ("操作失败"). This shim makes registration idempotent per name and
 * only swallows that specific duplicate error; any other failure still surfaces.
 */
export const CSS_REGISTER_PROPERTY_SHIM = "(()=>{const C=window.CSS;if(!C||typeof C.registerProperty!=='function'||C.registerProperty.__sdIdempotent)return;"
  + "const seen=new Set(),native=C.registerProperty.bind(C);"
  + "const wrapped=d=>{const n=d&&d.name;if(n&&seen.has(n))return;try{native(d)}catch(e){if(!(e&&e.name==='InvalidModificationError'))throw e}if(n)seen.add(n)};"
  + "wrapped.__sdIdempotent=true;C.registerProperty=wrapped})();";
