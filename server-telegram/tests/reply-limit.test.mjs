import test from 'node:test';
import assert from 'node:assert/strict';
import {seedReplyLimit,observeReply,reserveInitiation} from '../server/reply-limit.mjs';

const user=(text,at)=>({is_user:true,mes:text,send_date:at});
test('migration counts receipts once and excludes old messages imported after a reply',()=>{
 const rows=[user('Hello',100),{is_user:false,mes:'old',send_date:300,extra:{server_initiation:{id:'old'}}},
 {is_user:false,mes:'new',send_date:200,extra:{server_initiation:{id:'new',createdAt:200}}}];
 const t={chatId:'a',queue:[{id:'old',createdAt:50},{id:'new',createdAt:200}],archive:[{id:'new',createdAt:200}]};
 assert.equal(seedReplyLimit([{target:t,rows}]).count,1);
});
test('migration honours the most recent reply across same-companion bindings and caps old backlog',()=>{
 const old={target:{chatId:'old',queue:Array.from({length:15},(_,i)=>({id:String(i),createdAt:200+i}))},rows:[user('Hi',100)]};
 assert.equal(seedReplyLimit([old]).count,4);
 assert.equal(seedReplyLimit([old,{target:{chatId:'new',queue:[]},rows:[user('Reply',300)]}]).count,0);
});
test('only a new user turn resets; imports, edits, chat changes and other companions do not',()=>{
 const rows=[user('Hello',100)];const limit=seedReplyLimit([{target:{chatId:'a'},rows}]);
 for(let i=0;i<4;i++)reserveInitiation(limit);
 assert.throws(()=>reserveInitiation(limit));
 observeReply(limit,'a',[...rows,{is_user:false,mes:'import'}]);assert.equal(limit.count,4);
 observeReply(limit,'b',[user('Different old chat',50)]);assert.equal(limit.count,4);
 observeReply(limit,'a',[user('Edited',100)]);assert.equal(limit.count,4);
 const other=seedReplyLimit([{target:{chatId:'a'},rows}]);observeReply(other,'a',[...rows,user('Other reply',200)]);assert.equal(limit.count,4);
 assert(observeReply(limit,'a',[user('Edited',100),user('Hello again',300)]));assert.equal(limit.count,0);
 reserveInitiation(limit);assert.equal(limit.count,1);
 const restored=JSON.parse(JSON.stringify(limit));observeReply(restored,'a',[user('Edited',100),user('Hello again',300)]);assert.equal(restored.count,1);
});
test('ambiguous pre-upgrade receipts conservatively wait for a reply',()=>{
 assert.equal(seedReplyLimit([{target:{chatId:'a',queue:[{id:'unimported',createdAt:50}]},rows:[user('Hello')]}]).count,4);
});
