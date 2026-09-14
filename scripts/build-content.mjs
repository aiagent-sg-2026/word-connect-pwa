import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const base = {campaignVersion:'campaign-en-v1',contentVersion:'content-en-v1',dictionaryVersion:'dict-hand-v1',scoringVersion:'score-hand-v1',generatorVersion:'hand-authored-v1'};
const data = [
 ['L001','CAT',['CAT','ACT'],['AT'],['TACT'],1],
 ['L002','DOG',['DOG','GOD'],['DO','GO'],[],1],
 ['L003','SUN',['SUN'],['US'],[],1],
 ['L004','STAR',['STAR','RATS','ARTS','TAR'],['ART','SAT','RAT'],['TSAR'],2],
 ['L005','MOON',['MOON','MONO'],['MOO','ON'],[],2],
 ['L006','PLANT',['PLANT','PLAN','PANT','ANT'],['TAP','NAP','LAP'],[],2],
 ['L007','BREAD',['BREAD','BEAR','BARE','READ','DARE'],['BAD','RED','BED'],[],2],
 ['L008','STONE',['STONE','TONES','NOTES','TONE','NOTE'],['ONE','SET','NET'],[],3],
 ['L009','CLOUD',['CLOUD','COLD','LOUD'],['COD','DOC','OLD'],[],2],
 ['L010','GARDEN',['GARDEN','GRADE','RANGE','ANGER','DANGER'],['RED','EAR','AGE'],[],3],
 ['L011','SMILE',['SMILE','MILES','SLIM','LIME','MILE'],['ELM','LIE','SIM'],[],3],
 ['L012','BRIGHT',['BRIGHT','BIRTH','GIRTH','RIGHT'],['BIT','RIG','HIT'],[],3],
 ['L013','FLOWER',['FLOWER','LOWER','FOWLER','WOLF'],['FLOE','ROLE','OWE'],[],3],
 ['L014','MARKET',['MARKET','MAKER','TAKER','TAME'],['TEA','MET','ARM'],[],3],
 ['L015','CASTLE',['CASTLE','CLEATS','STALE','STEAL','TALES'],['SEA','CAT','TEAL'],[],4],
 ['L016','ORANGE',['ORANGE','ORGAN','ANGER','GROAN'],['RAN','EON','AGE'],[],4],
 ['L017','PLANET',['PLANET','PLANE','PANEL','LEANT'],['TEN','PEN','ANT'],[],4],
 ['L018','STREAM',['STREAM','MASTER','TAMERS','STARE','TEARS'],['SEA','RAM','EAST'],[],4],
 ['L019','CANDLE',['CANDLE','LANCED','DANCE','CLEAN','LANCE'],['CAN','LED','END'],[],4],
 ['L020','WONDER',['WONDER','DOWNER','OWNER','DROWN'],['ROW','NOW','RED'],[],5]
];
function canon(value){ if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canon(v)}`).join(',')}}`; return JSON.stringify(value); }
function hashLevel(l){ const copy={...l}; delete copy.hash; return createHash('sha256').update(canon(copy)).digest('hex'); }
const levels=data.map(([id,letters,targets,bonus,acceptOnly,difficulty])=>{ const l={...base,levelId:id,revision:1,letters:[...letters],targets,bonus,acceptOnly,difficulty,hash:''}; l.hash=hashLevel(l); return l; });
const campaignCopy={campaignVersion:base.campaignVersion,contentVersion:base.contentVersion,levels:levels.map(l=>l.hash)};
const campaignHash=createHash('sha256').update(canon(campaignCopy)).digest('hex');
writeFileSync('src/content/campaign.ts', `import type { CampaignManifest } from '../types';\n\nexport const CAMPAIGN: CampaignManifest = ${JSON.stringify({campaignVersion:base.campaignVersion,contentVersion:base.contentVersion,campaignHash,levels}, null, 2)} as const;\n`);
