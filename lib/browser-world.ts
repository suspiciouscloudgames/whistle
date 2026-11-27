import { abstractWorld, validateWorld, type World } from "./world.ts";
import { MAX_LIBRARY_SIZE } from "./content-limits.ts";

export type BrowserWorldStore = { read():Promise<World | undefined>; write(world:World):Promise<void> };
let opening:Promise<IDBDatabase> | undefined;
let connected:IDBDatabase | undefined;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("whistle-browser-worlds",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("worlds");
    request.onerror=()=>{opening=undefined;reject(request.error);};
    request.onsuccess=()=>{
      const db=request.result;
      connected=db;
      db.onversionchange=()=>{db.close();opening=undefined;connected=undefined;};
      resolve(db);
    };
  });
}
async function read<T>(key:string):Promise<T | undefined> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const request=db.transaction("worlds","readonly").objectStore("worlds").get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function archiveWriterKey(): Promise<string> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("worlds", "readwrite");
    const store = transaction.objectStore("worlds");
    const slot = JSON.stringify(["archive", "writer"]);
    const request = store.get(slot);
    let key: string;
    request.onsuccess = () => {
      key = request.result;
      if (typeof key === "string" && /^[0-9a-f]{64}$/.test(key)) return;
      key = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
      store.put(key, slot);
    };
    transaction.oncomplete = () => resolve(key);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function browserWorldStore(room:string,tab:string):BrowserWorldStore {
  const key=JSON.stringify(["document",tab]),latest=JSON.stringify(["document","latest"]);
  return {
    async read() {
      const own=await read<World>(key);
      if(own)return own;
      const previous=await read<string>(latest);
      if(previous)return read<World>(previous);
      const legacy=await read<World>(JSON.stringify([room,tab]));
      if(legacy)return legacy;
      const previousRoom=await read<string>(JSON.stringify([room,"latest"]));
      if(previousRoom)return read<World>(previousRoom);
      const stored=sessionStorage.getItem("whistle.world.tab.v1")??localStorage.getItem("whistle.world.v2");
      if(stored!==null)return JSON.parse(stored);
      const old=localStorage.getItem("whistle.world.v1");
      return old!==null?abstractWorld(validateWorld(JSON.parse(old),MAX_LIBRARY_SIZE)):undefined;
    },
    write(world) {
      const save=(db:IDBDatabase)=>new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction("worlds","readwrite");
        const store=transaction.objectStore("worlds");
        store.put(world,key);store.put(key,latest);
        transaction.oncomplete=()=>resolve();
        transaction.onabort=transaction.onerror=()=>reject(transaction.error);
      });
      return connected?save(connected):database().then(save);
    },
  };
}
