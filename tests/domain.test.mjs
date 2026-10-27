import test from 'node:test';
import assert from 'node:assert/strict';
import { groupProjects, hierarchyRows, projectKey, isAttention, isReadyToReview, attentionHeadline, hostGaps, permissionSummary, ago, attentionGroups, archivable, teamArchivable, withTeam, finishedSpecialists, sidebarCounts, watchedAgents, agentKey, projectState, toggleAssignedProject, toggleAssignedWorkspace } from '../.unit-dist/model.js';
import { planLaunchMode, escalation, isReadOnlyPrCommand, prManagerRequestAllowed } from '../.unit-dist/permissions.js';
import { transcriptRows, transcriptText } from '../.unit-dist/transcript.js';
import { parseQuestions, buildAnswers, toggleChoice } from '../.unit-dist/questions.js';
import { migrateToV8, migrateToV9, coordinatorInstructionsFor, preferences, isCoordinatorHome } from '../.unit-dist/settings.js';
import { coordinatorBrief, specialistPrompt } from '../.unit-dist/prompts.js';

const ws={serverId:'mac',workspaceId:'work1',projectId:'xdflow',projectName:'XDFlow',name:'main',directory:'/src/xdflow',status:'running'};
const ag=(agentId,labels={}, status='idle', workspaceId='work1')=>({serverId:'mac',agentId,workspaceId,title:agentId,status,model:'sonnet',provider:'claude',updatedAt:'2026-10-21T14:00:00Z',labels,requiresAttention:false,pendingPermissionCount:0,archived:false});

test('groups multiple workspaces into a project per host',()=>{
  const another={...ws,workspaceId:'work2',name:'test branch'};
  const projects=groupProjects([ws,another],[ag('lead'),ag('child',{},'running','work2')]);
  assert.equal(projects.length,1);assert.equal(projects[0].workspaces.length,2);assert.equal(projects[0].running,1);
  assert.equal(projectKey('mac','xdflow'),'mac:xdflow');
});

test('keeps work on separate hosts distinct even with matching project ids',()=>{
  const projects=groupProjects([ws,{...ws,serverId:'remote'}],[ag('x')]);
  assert.equal(projects.length,2);
});

test('attention is permissions and failures, not finished',()=>{
  assert.equal(isAttention(ag('a')),false);
  assert.equal(isAttention({...ag('a'),requiresAttention:true,attentionReason:'finished'}),false);
  assert.equal(isAttention({...ag('a'),requiresAttention:true,attentionReason:'permission'}),true);
  assert.equal(isAttention({...ag('a'),pendingPermissionCount:1}),true);
  assert.equal(isAttention({...ag('a'),status:'error'}),true);
});

test('managed Paseo and nested Claude native subagents produce one tree',()=>{
  const lead=ag('lead');const worker=ag('worker',{'paseo.parent-agent-id':'lead'});
  const child={serverId:'mac',id:'n1',parentAgentId:'worker',parentSubagentId:null,title:'Explore',description:'tests',status:'running',updatedAt:'2026-10-21T14:00:00Z'};
  const grandchild={...child,id:'n2',parentSubagentId:'n1',title:'Nested',status:'completed'};
  const rows=hierarchyRows([lead,worker],[child,grandchild]);
  assert.deepEqual(rows.map(r=>[r.title,r.depth,r.kind]),[['lead',0,'managed'],['worker',1,'managed'],['Explore',2,'native'],['Nested',3,'native']]);
});

test('malformed/cyclic agent labels never cause an infinite loop or data loss',()=>{
  const a=ag('a',{'paseo.parent-agent-id':'b'});const b=ag('b',{'paseo.parent-agent-id':'a'});
  const rows=hierarchyRows([a,b],[]);assert.equal(rows.length,2);
});

test('orphan native subagent is visible but not falsely attached',()=>{
  const n={serverId:'mac',id:'n',parentAgentId:'missing',parentSubagentId:null,title:'Unknown',description:'',status:'failed',updatedAt:'2026-10-21T14:00:00Z'};
  const rows=hierarchyRows([], [n]);assert.equal(rows.length,1);assert.equal(rows[0].requiresAttention,true);
});

test('specialist prompt covers scope, instructions and user task',()=>{
  const p=specialistPrompt({name:'Reviewer',instructions:'Check leakage.',task:'Investigate cache invalidation.',scope:'branch',projectName:'Payments'});
  assert.doesNotMatch(p,/notes/i);
  assert.match(p,/base branch/);assert.match(p,/Check leakage/);assert.match(p,/Investigate cache invalidation/);assert.match(p,/Do not commit/);
});

test('coordinator brief lists workspaces and agents with IDs and the snapshot disclaimer',()=>{
  const brief=coordinatorBrief([{host:'local',name:'Payments',workspaces:[{id:'wks_1',name:'main',directory:'/src/payments'}],agents:['Feature A (running, agent a1)'],attention:1}]);
  assert.doesNotMatch(brief,/notes/i);assert.match(brief,/agent a1/);assert.match(brief,/not a live feed/);assert.match(brief,/Attention items: 1/);assert.match(brief,/main: workspace wks_1, \/src\/payments/);
});

test('read-only profiles get a verified enforced mode or are refused, never a weaker fallback',()=>{
  const base={name:'Reviewer',modeId:'',requireReadOnly:true};
  assert.deepEqual(planLaunchMode({...base,providerModel:'claude/claude-haiku-4-5'}).modeId,'plan');
  assert.throws(()=>planLaunchMode({...base,providerModel:'opencode/x'}),/no read-only setup/);
  assert.throws(()=>planLaunchMode({...base,providerModel:'claude/x',modeId:'bypassPermissions'}),/Clear the mode or set it to "plan"/);
  assert.equal(planLaunchMode({...base,providerModel:'claude/x',modeId:'plan'}).kind,'read-only');
});

test('profiles that allow edits are labeled as not read-only',()=>{
  assert.deepEqual(planLaunchMode({name:'Debugger',providerModel:'codex/x',modeId:'',requireReadOnly:false}),{kind:'provider-default'});
  assert.deepEqual(planLaunchMode({name:'Debugger',providerModel:'claude/x',modeId:' acceptEdits ',requireReadOnly:false}),{kind:'chosen',modeId:'acceptEdits'});
});

test('attention headline never reports all clear while a host is unobserved',()=>{
  assert.equal(attentionHeadline(0,0).clear,true);
  const offline=attentionHeadline(0,1);
  assert.equal(offline.clear,false);assert.match(offline.text,/1 host\(s\) could not be read/);
  assert.equal(attentionHeadline(2,1).clear,false);
  assert.deepEqual(attentionHeadline(0,0,false),{text:'Agent status not read yet.',clear:false});
});

test('coordinator brief lists unavailable hosts as unknown, not clear',()=>{
  const brief=coordinatorBrief([],['laptop: Host offline']);
  assert.match(brief,/Unavailable hosts \(NOT included; their status is unknown, not clear\)/);
  assert.match(brief,/- laptop: Host offline/);
  assert.doesNotMatch(coordinatorBrief([]),/Unavailable hosts/);
});

test('host coverage follows the live host list: offline, failed, truncated and not-yet-read hosts are gaps',()=>{
  const hosts=[{serverId:'a',status:'online'},{serverId:'b',status:'offline'},{serverId:'c',status:'online'},{serverId:'d',status:'online'}];
  const gaps=hostGaps(hosts,['a'],{c:'More entries than Workbench reads'});
  assert.deepEqual(Object.keys(gaps).sort(),['b','c','d']);
  assert.match(gaps.b,/offline/);assert.match(gaps.c,/More entries/);assert.match(gaps.d,/Not read yet/);
  assert.deepEqual(hostGaps([{serverId:'a',status:'online'}],['a'],{}),{});
});

test('pull-request scope and second-opinion roles are explicit in the prompt',()=>{
  const base={name:'Reviewer',instructions:'Use the bar.',task:'',projectName:'P'};
  assert.match(specialistPrompt({...base,scope:'pull-request',prNumber:42}),/pull request #42.*gh pr view 42 --comments/s);
  const primary=specialistPrompt({...base,scope:'working-tree',secondOpinion:{role:'primary',model:'codex/x'}});
  assert.match(primary,/codex\/x/);assert.match(primary,/\[Workbench second opinion\]/);assert.match(primary,/verified\?/);
  assert.match(specialistPrompt({...base,scope:'working-tree',secondOpinion:{role:'second'}}),/second, independent reviewer/);
  assert.doesNotMatch(specialistPrompt({...base,scope:'working-tree'}),/second opinion/i);
});

test('codex read-only means the requested sandbox, never a mode; other providers still refused',()=>{
  const m=planLaunchMode({name:'R',providerModel:'codex/x',modeId:'',requireReadOnly:true});
  assert.equal(m.kind,'sandbox');assert.deepEqual(m.options,{sandbox_mode:'read-only',approval_policy:'never'});
  assert.throws(()=>planLaunchMode({name:'R',providerModel:'codex/x',modeId:'full-access',requireReadOnly:true}),/comes from its sandbox/);
  assert.throws(()=>planLaunchMode({name:'R',providerModel:'opencode/x',modeId:'',requireReadOnly:true}),/no read-only setup/);
});

test('coordinator homes are recognized (default and per-id), user projects are not',()=>{
  assert.equal(isCoordinatorHome('/Users/j/.paseo/plugin-data/workbench/coordinator'),true);
  assert.equal(isCoordinatorHome('/Users/j/.paseo/plugin-data/workbench/coordinators/c-abc1'),true);
  assert.equal(isCoordinatorHome('C:\\Users\\j\\.paseo\\plugin-data\\workbench\\coordinators\\c-1'),true);
  assert.equal(isCoordinatorHome('/Users/j/src/coordinator'),false);
  assert.equal(isCoordinatorHome('/Users/j/.paseo/plugin-data/workbench/coordinators/c-1/sub'),false);
});

test('coordinator auto-approval never covers permission escalation',()=>{
  assert.equal(escalation({provider:'claude/x',initialPrompt:'hi',workspaceId:'w'}),null);
  assert.match(escalation({settings:{modeId:'bypassPermissions'}}),/bypassPermissions/);
  assert.match(escalation({mode:'full-access'}),/full-access/);
  assert.match(escalation({agentId:'a',prompt:'go',sessionMode:'bypassPermissions'}),/bypass/);
  assert.match(escalation({labels:{'workbench.role':'coordinator'}}),/Workbench labels/);
  assert.equal(escalation(undefined),null);
});

test('permission summaries say exactly what would happen, without raw file bodies',()=>{
  assert.equal(permissionSummary({kind:'tool',name:'Bash',detail:{type:'shell',command:'git push origin main'}}),'$ git push origin main');
  assert.equal(permissionSummary({kind:'tool',name:'Edit',detail:{type:'edit',filePath:'src/x.py',oldString:'a'.repeat(5000),newString:'b'}}),'edit src/x.py');
  assert.equal(permissionSummary({kind:'tool',name:'WebFetch',detail:{type:'fetch',url:'https://example.com'}}),'fetch https://example.com');
  assert.equal(permissionSummary({kind:'plan',name:'ExitPlanMode'}),'wants to leave plan mode and make changes');
  assert.equal(permissionSummary({kind:'question',name:'AskUserQuestion',title:'Which base branch?'}),'asks: Which base branch?');
  assert.equal(permissionSummary({kind:'tool',name:'mcp__paseo__archive_agent'}),'mcp__paseo__archive_agent');
  assert.ok(permissionSummary({kind:'tool',name:'Bash',detail:{type:'shell',command:'x'.repeat(1000)}}).length<=200);
});

test('ago is coarse and tolerant of missing times',()=>{
  const now=Date.parse('2026-10-22T12:00:00Z');
  assert.equal(ago('2026-10-22T11:59:40Z',now),'just now');
  assert.equal(ago('2026-10-22T11:55:00Z',now),'5 min ago');
  assert.equal(ago('2026-10-22T09:00:00Z',now),'3 h ago');
  assert.equal(ago('2026-10-19T12:00:00Z',now),'3 d ago');
  assert.equal(ago(null,now),'');
});

test('attention groups: by project, blocked-on-you first, with evidence; agents outside projects kept',()=>{
  const projects=groupProjects([ws],[]);
  const waiting={...ag('w'),pendingPermissionCount:2,permissions:['$ git push','edit a.py'],attentionReason:'permission',attentionSince:'2026-10-22T10:00:00Z'};
  const failed={...ag('f'),status:'error',lastError:'Provider quota exceeded',attentionSince:'2026-10-22T11:00:00Z'};
  const done={...ag('d'),requiresAttention:true,attentionReason:'finished',attentionSince:'2026-10-22T11:30:00Z'};
  const coordinator={...ag('c',{'workbench.role':'coordinator'},'idle','home-ws'),requiresAttention:true,attentionReason:'finished'};
  const quiet=ag('q');
  const groups=attentionGroups([done,quiet,failed,waiting,coordinator],projects);
  const coordinatorAsks={...coordinator,pendingPermissionCount:1,attentionReason:'permission'};
  assert.deepEqual(attentionGroups([done,quiet,failed,waiting,coordinatorAsks],projects).map(g=>g.name),['XDFlow','Not in a project (Coordinators and others)']);
  assert.deepEqual(groups.map(g=>g.name),['XDFlow'],'finished agents are listed under Finished, not here');
  assert.deepEqual(groups[0].items.map(i=>[i.agentId,i.kind]),[['w','permission'],['f','error']]);
  assert.equal(groups[0].items[0].headline,'Waiting for your permission (2)');
  assert.deepEqual(groups[0].items[0].details,['$ git push','edit a.py']);
  assert.deepEqual(groups[0].items[1].details,['Provider quota exceeded']);
  assert.equal(groups[0].items[0].workspaceName,'main');
  const asksAfterFinishing={...ag('late'),pendingPermissionCount:1,requiresAttention:true,attentionReason:'finished',attentionSince:'2026-10-20T10:00:00Z',updatedAt:'2026-10-22T11:59:00Z'};
  assert.equal(attentionGroups([asksAfterFinishing],projects)[0].items[0].since,'2026-10-22T11:59:00Z','a stale finished time is not the permission\'s');
});

test('ready to review: exactly Paseo\'s green dot, subagents included',()=>{
  const done=o=>({...ag('x'),requiresAttention:true,attentionReason:'finished',...o});
  assert.equal(isReadyToReview(done({})),true);
  assert.equal(isReadyToReview(done({labels:{'paseo.parent-agent-id':'chair'}})),true,'a committee member or worker counts too');
  assert.equal(isReadyToReview(done({attentionReason:null})),true,'Paseo shows any other attention as green');
  assert.equal(isReadyToReview(done({requiresAttention:false})),false,'opened since it finished');
  assert.equal(isReadyToReview(done({pendingPermissionCount:1})),false);
  assert.equal(isReadyToReview(done({attentionReason:'permission'})),false);
  assert.equal(isReadyToReview(done({status:'error'})),false);
  assert.equal(isReadyToReview(done({attentionReason:'error'})),false);
  assert.equal(isReadyToReview(done({status:'running'})),false);
  assert.equal(isReadyToReview(done({archived:true})),false);
  const projects=groupProjects([ws],[done({}),{...ag('f'),status:'error'}]);
  assert.equal(projects[0].attention,1,'a project counts only what needs you');
});

test('committee prompts: chair writes the consensus with divergences, member cross-checks the chair',()=>{
  const base={name:'Reviewer',instructions:'Use the bar.',task:'',projectName:'P',scope:'working-tree'};
  const chair=specialistPrompt({...base,secondOpinion:{role:'chair',model:'codex/x'}});
  assert.match(chair,/chair a two-member review committee/);assert.match(chair,/codex\/x/);assert.match(chair,/\[Workbench committee\]/);assert.match(chair,/diverged/);
  const member=specialistPrompt({...base,secondOpinion:{role:'member',model:'claude/y'}});
  assert.match(member,/member of a two-member review committee/);assert.match(member,/claude\/y/);assert.doesNotMatch(member,/write the committee's consensus/);
});

test('attention: agents started by another agent surface permissions and failures, labeled with their parent',()=>{
  const projects=groupProjects([ws],[]);
  const chair={...ag('chair'),title:'Reviewer: P'};
  const memberDone={...ag('m1',{'paseo.parent-agent-id':'chair'}),requiresAttention:true,attentionReason:'finished'};
  const memberAsks={...ag('m2',{'paseo.parent-agent-id':'chair'}),pendingPermissionCount:1,permissions:['$ rm -rf build']};
  const groups=attentionGroups([chair,memberDone,memberAsks],projects);
  assert.deepEqual(groups.flatMap(g=>g.items.map(i=>[i.agentId,i.via])),[['m2','Reviewer: P']]);
});

test('transcript: your messages, Workbench relays apart, merged streamed replies, one line per tool, failures',()=>{
  const rows=transcriptRows([
    {type:'user_message',text:'You are the Workbench Coordinator "X". Read CONTEXT.md'},
    {type:'assistant_message',text:'Hello '},{type:'assistant_message',text:'there'},
    {type:'reasoning',text:'hidden'},
    {type:'tool_call',name:'Bash',status:'completed',detail:{type:'shell',command:'git status'}},
    {type:'user_message',text:'Start the tests'},
    {type:'user_message',text:'[Workbench committee] The member\'s review (agent a1):\n\nfindings'},
    {type:'turn_failed',error:'quota exceeded'},
  ]);
  assert.deepEqual(rows.map(r=>r.kind),['workbench','assistant','tool','user','workbench','error']);
  assert.equal(rows[1].text,'Hello there');
  assert.equal(rows[2].text,'$ git status');
  assert.equal(rows[4].title,"[Workbench committee] The member's review (agent a1):");
});

test('questions: parsed from the permission input and answered like Paseo\'s card',()=>{
  const qs=parseQuestions({questions:[{question:'Which base?',header:'Base',options:[{label:'main'},{label:'dev'}],multiSelect:false},{question:'Areas?',header:'Areas',options:[{label:'a'},{label:'b'},{label:'c'}],multiSelect:true}]});
  assert.equal(qs.length,2);
  assert.equal(buildAnswers(qs,{0:[1]},{}),null,'unanswered question blocks submit');
  assert.deepEqual(buildAnswers(qs,{0:[1],1:[2,0]},{}),{Base:'dev',Areas:'a, c'});
  assert.deepEqual(toggleChoice([0],1,false),[1]);assert.deepEqual(toggleChoice([0],0,false),[]);assert.deepEqual(toggleChoice([0],1,true),[0,1]);
  assert.equal(parseQuestions({command:'ls'}),null);
  const free=parseQuestions({questions:[{question:'Why?',header:'Why',options:[]}]});
  assert.deepEqual(buildAnswers(free,{},{0:' because '}),{Why:'because'});
});

test('session summaries: transcript as text keeps the newest part, prompt embeds it between markers',()=>{
  const rows=transcriptRows([{type:'user_message',text:'Fix the bug'},{type:'assistant_message',text:'Done, tests pass'},{type:'tool_call',name:'Bash',status:'completed',detail:{type:'shell',command:'pytest'}}]);
  const text=transcriptText(rows);
  assert.match(text,/^User: Fix the bug\n\nAgent: Done, tests pass\n\n  \[tool completed\] \$ pytest$/);
  const cut=transcriptText(rows,20);
  assert.match(cut,/^\(earlier part omitted\)/);assert.match(cut,/pytest$/);
  const p=specialistPrompt({name:'Session summarizer',instructions:'Summarize.',task:'',projectName:'P',scope:'session',session:{agentId:'a1',title:'Bugfix',transcript:text}});
  assert.match(p,/Summarize the Paseo agent session "Bugfix" \(agent a1\)/);assert.match(p,/<<<SESSION\nUser: Fix the bug/);assert.match(p,/SESSION>>>/);
});

test('PR manager: only single read-only gh/git commands run without asking',()=>{
  for (const ok of ['gh pr list -R octocat/Hello-World --author @me','gh -R o/r pr view 12 --json title,mergeable','gh pr checks 3 -R o/r','gh run view 99 -R o/r --log-failed','gh api repos/o/r/pulls/3/comments','git -C /src/app status','git -C /src/app log --oneline -5','gh pr list --search "review-requested:@me" -R o/r'])
    assert.equal(isReadOnlyPrCommand(ok),true,ok);
  for (const bad of ['gh pr merge 3 -R o/r','gh pr comment 3 -b hi','gh pr checkout 3','gh pr review 3 --approve','gh pr view 3 --web','gh api -X POST repos/o/r/issues','gh api repos/o/r/pulls -f title=x','git -C /src push origin main','git push','gh pr list; rm -rf /','gh pr list && git push','gh pr list | sh','gh pr view $(cat x)','gh pr view `id`','cd /src && gh pr list','gh pr list > out.txt',''])
    assert.equal(isReadOnlyPrCommand(bad),false,bad);
});

test('PR manager: worktrees only at a PR; fixers only in ask-before-shell modes',()=>{
  assert.equal(prManagerRequestAllowed('create_workspace',{isolation:'worktree',mode:'checkout-pr',prNumber:3,path:'/src'}),true);
  assert.equal(prManagerRequestAllowed('create_workspace',{isolation:'local',path:'/'}),false);
  assert.equal(prManagerRequestAllowed('create_workspace',{isolation:'worktree',mode:'branch-off'}),false);
  assert.equal(prManagerRequestAllowed('create_agent',{provider:'claude/x',settings:{modeId:'acceptEdits'}}),true);
  assert.equal(prManagerRequestAllowed('create_agent',{provider:'claude/x'}),false,'Claude default may be auto (classifier approves pushes)');
  assert.equal(prManagerRequestAllowed('create_agent',{provider:'claude/x',settings:{modeId:'auto'}}),false);
  assert.equal(prManagerRequestAllowed('create_agent',{provider:'codex/x'}),true);
  assert.equal(prManagerRequestAllowed('create_agent',{provider:'codex/x',settings:{modeId:'full-access'}}),false);
  assert.equal(prManagerRequestAllowed('create_agent',{provider:'opencode/x'}),false);
  assert.equal(prManagerRequestAllowed('list_agents',{}),true);
});

test('PR manager brief names the PRs to watch; new coordinators are general by default',()=>{
  const brief=coordinatorBrief([],[],{coordinatorName:'PRs',scoped:false,missing:[],prScope:['mine','review-requested']});
  assert.match(brief,/Pull requests to watch: mine \(--author @me\); asking for my review/);
  assert.match(coordinatorBrief([],[],{coordinatorName:'PRs',scoped:false,missing:[],prScope:['all','mine']}),/Pull requests to watch: all open/);
  assert.doesNotMatch(coordinatorBrief([],[],{coordinatorName:'C',scoped:false,missing:[]}),/Pull requests/);
  assert.deepEqual([preferences.schema.parse({}).coordinators[0].kind,preferences.schema.parse({}).coordinators[0].prScope],['general',['mine']]);
});

test('any specialist can run as a coordinator: role plus expertise; coordinator-only profiles keep their own text',()=>{
  const reviewerLead=coordinatorInstructionsFor({instructions:'Review for leakage.',coordinatorOnly:false});
  assert.match(reviewerLead,/^You are a Workbench Coordinator/);assert.match(reviewerLead,/Your specialty[^]*Review for leakage\./);
  assert.equal(coordinatorInstructionsFor({instructions:'PR text',coordinatorOnly:true}),'PR text');
});

test('settings v8 + PR manager in a workspace: not coordinator-only, own instructions as a coordinator, pull-requests scope',()=>{
  const v=migrateToV8({helpers:[{id:'pr-manager',coordinatorOnly:true},{id:'coordinator',coordinatorOnly:true}]});
  assert.deepEqual(v.helpers.map(h=>h.coordinatorOnly),[false,true]);
  const pm=preferences.schema.parse({}).helpers.find(h=>h.id==='pr-manager');
  assert.equal(pm.coordinatorOnly,false);
  assert.equal(coordinatorInstructionsFor(pm),pm.instructions,'not wrapped in the general coordinator text');
  const p=specialistPrompt({name:'PR manager',instructions:'x',task:'',projectName:'P',scope:'pull-requests',prWatch:['mine','review-requested']});
  assert.match(p,/this workspace's repository only/);assert.match(p,/--author @me/);assert.match(p,/review-requested:@me/);assert.match(p,/asks the user first/);
});

test('coordination picker: whole projects or single workspaces, normalized both ways',()=>{
  const p={projectId:'p',workspaces:[{workspaceId:'w1'},{workspaceId:'w2'},{workspaceId:'w3'}]};
  let a={projectIds:[],workspaceIds:['x9']};
  a=toggleAssignedProject(a,p); assert.deepEqual(a,{projectIds:['p'],workspaceIds:['x9']}); assert.equal(projectState(a,p),'all');
  a=toggleAssignedWorkspace(a,p,'w2'); assert.deepEqual(a,{projectIds:[],workspaceIds:['x9','w1','w3']}); assert.equal(projectState(a,p),'some');
  a=toggleAssignedWorkspace(a,p,'w2'); assert.deepEqual(a,{projectIds:['p'],workspaceIds:['x9']},'last one back -> whole project');
  a=toggleAssignedProject(a,p); assert.deepEqual(a,{projectIds:[],workspaceIds:['x9']}); assert.equal(projectState(a,p),'none');
  a=toggleAssignedWorkspace(a,p,'w1'); assert.deepEqual(a,{projectIds:[],workspaceIds:['x9','w1']});
  a=toggleAssignedProject(a,p); assert.deepEqual(a,{projectIds:['p'],workspaceIds:['x9']},'some -> all');
});

test('skills: listed skills become one "load these first" line in specialist and coordinator prompts',()=>{
  const p=specialistPrompt({name:'Reviewer',instructions:'Review.',task:'',projectName:'P',scope:'working-tree',skills:['review-style','x.y']});
  assert.match(p,/load these skills if they are available to you, and follow them: `review-style`, `x\.y`/);
  assert.doesNotMatch(specialistPrompt({name:'R',instructions:'Review.',task:'',projectName:'P',scope:'working-tree'}),/load these skills/);
  assert.match(coordinatorInstructionsFor({id:'reviewer',instructions:'Review.',coordinatorOnly:false,skills:['review-style']}),/Your specialty[\s\S]*`review-style`/);
  assert.throws(()=>preferences.schema.parse({helpers:[{id:'abc',name:'A',description:'',instructions:'x',skills:['--evil']}]}));
});

test('specialist files: header + body parse into a specialist; errors are specific; folder entries replace by id',async()=>{
  const { parseSpecialistFile, mergeSpecialists } = await import('../.unit-dist/specialistFiles.js');
  const r=parseSpecialistFile('Reviewer.md','---\nname: Reviewer\nskills: [review-style, experiment-checks]\nreview: committee\nsecond-model: codex/gpt-6.1-sol\n---\nYou are an independent code reviewer.\n');
  assert.ok('specialist' in r, r.error);
  assert.deepEqual([r.specialist.id,r.specialist.name,r.specialist.skills,r.specialist.defaultReview,r.specialist.requireReadOnly,r.specialist.instructions],['reviewer','Reviewer',['review-style','experiment-checks'],'committee',true,'You are an independent code reviewer.']);
  const plain=parseSpecialistFile('data-auditor.md','Check the data.');
  assert.equal(plain.specialist.name,'data-auditor'); assert.equal(plain.specialist.instructions,'Check the data.');
  assert.match(parseSpecialistFile('x-y.md','---\ncolour: red\n---\nhi').error,/unknown header key\(s\) colour/);
  assert.match(parseSpecialistFile('x-y.md','---\nread-only: maybe\n---\nhi').error,/must be true or false/);
  assert.match(parseSpecialistFile('Bad Name.md','hi').error,/id/);
  assert.match(parseSpecialistFile('x-y.md','---\nname: X\n---\n').error,/instructions/);
  const stored=preferences.schema.parse({}).helpers;
  const merged=mergeSpecialists(stored,[r.specialist,plain.specialist]);
  assert.equal(merged.length,stored.length+1);
  assert.equal(merged.find(h=>h.id==='reviewer').skills[0],'review-style','folder reviewer replaces the built-in in place');
  assert.equal(merged.findIndex(h=>h.id==='reviewer'),stored.findIndex(h=>h.id==='reviewer'));
});

test('import: Export JSON or a bare list; same id replaces; invalid or over-limit imports change nothing',async()=>{
  const { importSpecialists } = await import('../.unit-dist/specialistFiles.js');
  const stored=preferences.schema.parse({}).helpers;
  const r=importSpecialists(stored,JSON.stringify({helpers:[{id:'reviewer',name:'My reviewer',description:'',instructions:'Mine.',skills:['review-style']},{id:'auditor',name:'Auditor',description:'',instructions:'Audit.'}],coordinators:[]}));
  assert.deepEqual([r.added,r.replaced],[1,1]);
  assert.equal(r.helpers.find(h=>h.id==='reviewer').name,'My reviewer');
  assert.match(importSpecialists(stored,'nope').error,/JSON/);
  assert.match(importSpecialists(stored,JSON.stringify([{id:'Bad',name:'x',description:'',instructions:'y'}])).error,/Specialist 1/);
  const many=Array.from({length:20},(_,i)=>({id:`c-${i}x`,name:'n',description:'',instructions:'i'}));
  assert.match(importSpecialists(stored,JSON.stringify(many)).error,/limit is 20/);
});

test('defaults: the specialist set, in order, generic, with the Reviewer on a committee',()=>{
  const fresh=preferences.schema.parse({});
  assert.deepEqual(fresh.helpers.map(h=>h.id),['coordinator','reviewer','experiment-reviewer','debugger','session-summarizer','pr-manager']);
  assert.equal(fresh.helpers[0].name,'Coordinator');
  assert.equal(fresh.helpers.find(h=>h.id==='reviewer').defaultReview,'committee');
  assert.ok(fresh.helpers.find(h=>h.id==='coordinator').coordinatorOnly);
  assert.ok(fresh.helpers.every(h=>Array.isArray(h.skills)&&!h.skills.length));
  assert.equal(fresh.helpers.find(h=>h.id==='experiment-reviewer').requireReadOnly,true);
  assert.deepEqual(fresh.coordinators.map(c=>c.id),['default']);
});

test('settings v9: an unchanged "General coordinator" becomes "Coordinator"; a chosen name stays',()=>{
  assert.equal(migrateToV9({helpers:[{id:'coordinator',name:'General coordinator'}]}).helpers[0].name,'Coordinator');
  assert.equal(migrateToV9({helpers:[{id:'coordinator',name:'Lead'}]}).helpers[0].name,'Lead');
  assert.equal(preferences.migrate({helpers:[{id:'coordinator',name:'General coordinator'}]},8).helpers[0].name,'Coordinator');
});

test('archive: only done, non-coordinator agents; a specialist goes with its review team; bulk takes finished top-level specialists',()=>{
  const ag=(id,o={})=>({serverId:'s',agentId:id,workspaceId:'w',title:id,status:'idle',model:'',provider:'',updatedAt:'',labels:{},requiresAttention:false,pendingPermissionCount:0,archived:false,...o});
  const rev=ag('rev',{labels:{'workbench.helper':'reviewer'}});
  const member=ag('mem',{labels:{'workbench.helper':'reviewer','workbench.second-opinion-for':'rev','paseo.parent-agent-id':'rev'}});
  const busy=ag('busy',{status:'running',labels:{'workbench.helper':'debugger'}});
  const asking=ag('ask',{pendingPermissionCount:1,labels:{'workbench.helper':'debugger'}});
  const coord=ag('co',{labels:{'workbench.role':'coordinator'}});
  const mine=ag('mine');
  assert.deepEqual([rev,member,busy,asking,coord,mine].map(archivable),[true,true,false,false,false,true]);
  assert.deepEqual(withTeam([rev,member,mine],'s','rev'),['rev','mem']);
  assert.deepEqual(finishedSpecialists([rev,member,busy,asking,coord,mine]).map(a=>a.agentId),['rev'],'not team members, busy, asking, coordinators or your own agents');
  const reviewing={...member,status:'running'};
  assert.equal(teamArchivable([rev,reviewing],rev),false,'a chair idling while its member still reviews is not offered');
  assert.deepEqual(finishedSpecialists([rev,reviewing]).map(a=>a.agentId),[]);
  assert.equal(teamArchivable([rev,member],rev),true);
});

test('watched agents: everything except what was unchecked in Overview, by agent or by project',()=>{
  const a=ag('a'),b=ag('b'),other={...ag('a'),serverId:'pod'};
  assert.equal(agentKey(a),'mac:a');
  const none={agents:[],projects:[]};
  assert.deepEqual(watchedAgents([a,b,other],[ws],{agents:['mac:a'],projects:[]}).map(agentKey),['mac:b','pod:a'],'the same id on another host stays');
  assert.equal(watchedAgents([a,b],[ws],none).length,2,'checked by default');
  const elsewhere=ag('c',{},'idle','home-ws');
  assert.deepEqual(watchedAgents([a,b,elsewhere],[ws],{agents:[],projects:['mac:xdflow']}).map(agentKey),['mac:c'],'an unchecked project takes all its agents; others stay');
});

test('sidebar counts: Paseo\'s buckets (needs input, failed, working, ready to review)',()=>{
  const ag=(id,o={})=>({serverId:'s',agentId:id,workspaceId:'w',title:id,status:'idle',model:'',provider:'',updatedAt:'',labels:{},requiresAttention:false,pendingPermissionCount:0,archived:false,...o});
  const agents=[ag('ask',{requiresAttention:true,attentionReason:'permission',pendingPermissionCount:1}),ag('run',{status:'running'}),ag('init',{status:'initializing'}),ag('gone',{status:'running',archived:true}),ag('idle')];
  const projects=groupProjects([{serverId:'s',workspaceId:'w',projectId:'p',projectName:'P',name:'main',directory:'/x',status:'active'}],agents);
  const more=[...agents,ag('broke',{status:'error'}),ag('done',{requiresAttention:true,attentionReason:'finished'})];
  assert.deepEqual(sidebarCounts(more,projects),{needsInput:1,failed:1,running:2,finished:1},'Paseo\'s buckets; the archived runner is not counted');
});

test('questions keep each option\'s full information (description, preview)',()=>{
  const [q]=parseQuestions({questions:[{question:'Which plan?',header:'Plan',multiSelect:false,options:[{label:'A',description:'Fast, but skips the cache.',preview:'step 1\nstep 2'},{label:'B'}]}]});
  assert.deepEqual(q.options,[{label:'A',description:'Fast, but skips the cache.',preview:'step 1\nstep 2'},{label:'B'}]);
});

test('PR manager read-only filter: every argument is allowlisted (registry review #1035)',()=>{
  const ok=['gh pr view 12 -R o/r --json title,author,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments,updatedAt','gh pr list -R o/r --state=open --limit 20',
    'gh run list -R o/r --branch main -L 5','gh api repos/o/r/pulls/3/reviews --paginate --jq \'.[].state\'','gh api repos/{owner}/{repo}/pulls/3/comments','gh api "repos/o/r/pulls?per_page=100"','git -C /src/app diff --stat HEAD~1 -- src',
    'git -C /src/app branch -vv','git -C /src/app branch --show-current','git -C /src/app fetch origin','git -C /src/app fetch --prune','git -C /src/app remote -v','git -C /src/app rev-parse --abbrev-ref HEAD','git -C /src/app show --stat abc123'];
  for (const c of ok) assert.equal(isReadOnlyPrCommand(c),true,c);
  const bad=[
    // The two shapes from the review.
    'gh api repos/OWNER/REPO/issues/comments/COMMENT_ID -XDELETE','git -C /path/to/repository branch -D topic',
    // Other ways around a blocklist.
    'gh api repos/o/r/issues/1 -X=DELETE','gh api repos/o/r/issues/1 --method=PATCH','gh api repos/o/r/issues/1 -H "X-HTTP-Method-Override: DELETE"','gh api graphql',
    'gh api repos/o/r/issues --input body.json','gh api repos/o/r/issues -fbody=x','gh -R o/r api repos/o/r','gh pr list -L5','gh pr view 3 -w','gh pr close 3','gh pr view 3 --comments=1',
    'gh run rerun 9 -R o/r','gh run view abc -R o/r','git -C /src branch topic','git -C /src branch -d topic','git -C /src branch -m a b','git -C /src branch --delete topic',
    'git -C /src log --output=/tmp/x','git -C /src diff --no-index /etc/passwd /tmp/x','git -C /src diff --ext-diff','git -C /src fetch origin +main:main','git -C /src fetch origin pull/1/head:pr-1',
    // Brace expansion and globs (registry review: one word becomes several).
    'gh api {-XDELETE,repos/o/r/git/refs/heads/main}','gh api {--method=PUT,repos/o/r/pulls/1/merge}','git -C /repo log {--output=/tmp/pwn,HEAD}','git -C /src diff -- *','gh api repos/o/r/pulls/3/reviews --jq .[].state',
    'git -C /src -c core.pager=sh log','git -C -x status','git -C /src remote add evil url','git -C /src remote -v x','git -C /src status "unbalanced','GIT_DIR=/x git -C /src status','git -C /src checkout main',
  ];
  for (const c of bad) assert.equal(isReadOnlyPrCommand(c),false,c);
});
