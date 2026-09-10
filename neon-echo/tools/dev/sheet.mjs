/**
 * Контактний аркуш спрайтів: дістає названі кадри з готового атласу
 * й малює їх збільшеними в один PNG. Потрібен, щоб очима перевірити,
 * що силует нового ворога читається, а не вгадувати по коду.
 *   OUT=/tmp/sheet.png Z=6 node tools/dev/sheet.mjs e_rammer_n e_anvil_n ...
 */
import fs from 'fs'; import { PNG } from 'pngjs';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atlas=PNG.sync.read(fs.readFileSync(root+'/public/assets/atlas.png'));
const js=JSON.parse(fs.readFileSync(root+'/public/assets/atlas.json','utf8'));
const names=process.argv.slice(2);
const Z=Number(process.env.Z||4);
let cw=0, ch=0;
for(const n of names){const f=js.frames[n].frame; cw=Math.max(cw,f.w); ch=Math.max(ch,f.h);}
const cols=Math.min(names.length, 8), rows=Math.ceil(names.length/cols);
const out=new PNG({width:cols*(cw+2)*Z, height:rows*(ch+10)*Z});
for(let i=0;i<out.data.length;i+=4){out.data[i]=18;out.data[i+1]=10;out.data[i+2]=38;out.data[i+3]=255;}
names.forEach((n,i)=>{
  const f=js.frames[n].frame; const cx=(i%cols)*(cw+2)*Z, cy=Math.floor(i/cols)*(ch+10)*Z;
  for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){
    const si=((f.y+y)*atlas.width+(f.x+x))*4; const a=atlas.data[si+3]; if(!a)continue;
    for(let dy=0;dy<Z;dy++)for(let dx=0;dx<Z;dx++){
      const di=((cy+y*Z+dy)*out.width+(cx+x*Z+dx))*4;
      out.data[di]=atlas.data[si];out.data[di+1]=atlas.data[si+1];out.data[di+2]=atlas.data[si+2];out.data[di+3]=255;
    }
  }
});
fs.writeFileSync(process.env.OUT||'/tmp/sheet.png', PNG.sync.write(out));
console.log('ok', names.length);
