import { beforeEach, describe, expect, it } from 'vitest';
import { getReviews, getReviewerId, saveReview, setReviewerId } from './store';
import type { HumanReview } from '../golden/contracts';

const DB='word-connect-human-reviewer-v1';
async function resetDb(){ await new Promise<void>((resolve,reject)=>{ const r=indexedDB.deleteDatabase(DB); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); r.onblocked=()=>resolve(); }); }
const review=(queueChecksum:string, klass:HumanReview['class']):HumanReview=>({schemaVersion:'human-golden-review-v1',queueVersion:'human-golden-queue-v1',queueChecksum,word:'SYNTH',reviewerId:'reviewer-a',reviewedAt:'2026-01-01T00:00:00.000Z',source:'human-review-v1',class:klass,confidence:.8});

describe('reviewer IndexedDB isolation',()=>{
  beforeEach(resetDb);
  it('stores an explicit reviewer identity and one current row per queue+reviewer+word',async()=>{
    await setReviewerId('reviewer-a'); expect(await getReviewerId()).toBe('reviewer-a');
    await saveReview(review('queue-a','TARGET')); await saveReview(review('queue-a','BONUS')); await saveReview(review('queue-b','REVIEW'));
    const a=await getReviews('reviewer-a','human-golden-queue-v1','queue-a'); const b=await getReviews('reviewer-a','human-golden-queue-v1','queue-b');
    expect(a).toHaveLength(1); expect(a[0].class).toBe('BONUS'); expect(b).toHaveLength(1); expect(b[0].class).toBe('REVIEW');
  });
  it('rejects an implicit/short reviewer identity',async()=>{ await expect(setReviewerId('x')).rejects.toThrow(/at least 3/); });
});
