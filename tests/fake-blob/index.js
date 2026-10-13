export const store = new Map();
export const deleted = [];
export async function get(path){ const b = store.get(path); if(!b) return null; return { statusCode:200, stream:new Response(b).body, blob:{size:b.length} }; }
export async function del(paths){ for(const p of paths){ deleted.push(p); store.delete(p);} }
export async function issueSignedToken(o){ return "tok:"+o.pathname; }
export async function put(path, body){ store.set(path, Buffer.from(body)); return { pathname: path }; }
