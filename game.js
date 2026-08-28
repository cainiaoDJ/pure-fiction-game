var game=document.getElementById('game');
var el={stage:document.querySelector('.stage'),chapter:document.getElementById('chapter'),speaker:document.getElementById('speaker'),text:document.getElementById('text'),choices:document.getElementById('choices'),score:document.getElementById('score'),bar:document.getElementById('score-bar'),source:document.getElementById('source-label'),clock:document.getElementById('clock'),failure:document.getElementById('failure'),evidence:document.getElementById('evidence-row'),trust:document.getElementById('trust-row'),portrait:document.getElementById('portrait-card'),portraitImg:document.getElementById('portrait-img'),portraitName:document.getElementById('portrait-name'),voice:document.getElementById('voice'),voiceToggle:document.getElementById('voice-toggle')};

// NPC 头像映射
var portraits={'琥珀':'assets/portrait_amber.webp','零号':'assets/portrait_zero.webp','律师':'assets/portrait_lawyer.webp','经纪人':'assets/portrait_agent.webp'};
var speakerToTrust={琥珀:'amber',零号:'zero',律师:'lawyer',经纪人:'agent'};
// 配音：speaker → voice 子目录
var speakerToVoice={'琥珀':'amber','零号':'zero','律师':'lawyer','经纪人':'agent','旁白':'narrator','书记员':'clerk','数据员':'data','会计':'accountant','监控台':'monitor','甲骨文 AI':'oracle'};
var voiceEnabled=true;
var state;
var currentSceneId=null;
function S(chapter,speaker,text,choices,skin){return {chapter:chapter,speaker:speaker,text:text,choices:choices,skin:skin||'scene-harbor'};}
function C(label,hint,kind,delta,next,cost,sideEffect,aiDebt,ev,trust){return {label:label,hint:hint,kind:kind,delta:delta,next:next,cost:cost||3,sideEffect:sideEffect||null,aiDebt:aiDebt||0,ev:ev||null,trust:trust||null};}
function reset(){state={score:50,prevScore:50,kind:{procedure:0,self:0,rumor:0,ai:0},history:[],time:72,aiDebt:0,sideEffects:[],failure:null,handledEvents:[],crisisPause:null,activeCrisis:null,evidence:[],trust:{amber:50,zero:50,lawyer:50,agent:50}};if(el.failure)el.failure.hidden=true;show('start');}

var evNames={court_receipt:'法院回执',metadata:'元数据',recording:'电话录音',template:'文件原件',playbook:'传播预案'};
function evName(id){return evNames[id]||id;}

function pick(c){
  // 打断上一句配音
  stopVoice();
  state.prevScore=state.score;
  state.score=Math.max(0,Math.min(100,state.score+c.delta));
  state.kind[c.kind]=(state.kind[c.kind]||0)+1;
  state.history.push(c.kind);
  state.aiDebt+=c.aiDebt||0;
  state.time=Math.max(0,state.time-c.cost);
  if(c.sideEffect)state.sideEffects.push(c.sideEffect);
  // Tier 2B: 证据系统 — gain / burn
  if(c.ev){
    if(c.ev.gain){
      if(state.evidence.length<3){
        state.evidence.push(c.ev.gain);
        state.sideEffects.push('获得证据：'+evName(c.ev.gain));
        playEvidenceGain();
        pulseEvidenceRow();
      }else{
        state.sideEffects.push('证据已满，新证据「'+evName(c.ev.gain)+'」被丢弃');
      }
    }
    if(c.ev.burn){
      var idx=state.evidence.indexOf(c.ev.burn);
      if(idx>=0){
        state.evidence.splice(idx,1);
        state.sideEffects.push('已使用证据：'+evName(c.ev.burn));
        playEvidenceBurn();
        pulseEvidenceRow();
      }
    }
  }
  // Tier 2C: NPC 信任度变化
  if(c.trust){
    var currentSpeakerKey=speakerToTrust[el.speaker.textContent];
    for(var k in c.trust){
      if(state.trust[k]!==undefined){
        state.trust[k]=Math.max(0,Math.min(100,state.trust[k]+c.trust[k]));
        // 如果当前立绘对应的 NPC 信任变化了，触发 pulse
        if(k===currentSpeakerKey&&el.portrait){
          var frame=el.portrait.querySelector('.portrait-frame');
          if(frame){
            frame.classList.remove('pulse');
            void frame.offsetWidth;
            frame.classList.add('pulse');
            setTimeout(function(){frame.classList.remove('pulse');},650);
          }
        }
      }
    }
  }
  // 选择的"咬合"反馈：按 kind 区分的短音 + 分数条脉冲
  if(!state.failure){
    playChoiceSting(c.kind,c.delta);
    pulseScoreBar();
  }
  // AI 代理权债务 3+：AI 主动越权，自动发布（+轻微叙事可信度下降）
  if(state.aiDebt>=3&&c.kind==='ai'&&state.failure===null){
    state.score=Math.max(0,state.score-4);
    state.sideEffects.push('AI 已绕过你，将上一稿直接推送到琥珀的官方账号');
  }
  // 阈值跨过检测
  if(state.prevScore<80&&state.score>=80&&state.failure===null){
    showScoreBurst('gold','你压住了场面');
  }
  if(state.prevScore>20&&state.score<=20&&state.failure===null){
    showScoreBurst('red','你失去了控制');
  }
  // 失败判定（按优先级：AI 接管 > 叙事失控 > 错过终局）
  if(state.aiDebt>=5){
    state.failure='ai_overrun';
  }else if(state.score<=0){
    state.failure='lost';
  }else if(state.time<=0){
    state.failure='timeout';
  }
  // 解析 target next
  var target=c.next;
  if(target==='__resume__'){
    if(state.activeCrisis){
      state.handledEvents.push(state.activeCrisis);
      state.activeCrisis=null;
    }
    target=state.crisisPause;
    state.crisisPause=null;
  }
  // 检查是否有危机事件要插入（失败态或已经在处理危机时不插入）
  if(!state.failure&&!state.activeCrisis){
    var evKey=checkCrisisEvent();
    if(evKey){
      state.crisisPause=target;
      state.activeCrisis=evKey;
      show('crisis:'+evKey);
      return;
    }
  }
  show(target);
}

var scenes={
start:S('序章 / 72 小时','旁白','镜港凌晨 02:17。<br>一篇《我与琥珀：一篇虚构小说》冲上榜首；十七分钟后，白塔法院的电子回执送进工作室。<br><br>你是"剪辑师"。你的工作不是证明谁值得被爱，而是决定什么有资格被相信。',[C('先保存法院回执','程序文件：慢，但会留下时间戳','procedure',12,'receipt',3,'法院回执已封存',0,{gain:'court_receipt'},{lawyer:5}),C('先读"虚构小说"','单方叙事：快、浓、擅长抢走注意力','self',-3,'novel',4,'虚构先一步占领了注意',null,{amber:-2})],'scene-harbor'),
receipt:S('第一章 / 白塔的冷光','书记员','回执只有三句话：申请已登记；保全请求待审；被申请人提出管辖权异议。<br><br>律师说："它不浪漫，但是它目前唯一不需要猜的东西。"<br>琥珀盯着热搜问："他们会不会把立案写成判决？"',[C('发布程序时间线','只说可核验的状态','procedure',9,'switchboard',4,'时间线公开了，但没人看'),C('不回应，先观察热搜','沉默也会被算法配音','rumor',-4,'switchboard',7,'沉默被算法翻译成傲慢')],'scene-court'),
novel:S('第一章 / 标着虚构的小说','琥珀','小说把十九年暗恋写成一项长期投资：旧照片、包场、旅行、账本、一次"永不拒绝"的测试。每一段像证词，每一页又写着"纯属虚构"。<br><br>琥珀把屏幕扣在桌上："他想让我对一篇小说负责。"',[C('给文章贴上"单方叙事"标签','拒绝让小说替代诉状','procedure',8,'switchboard',4,'标签被引用了 4 千次',0,null,{lawyer:3}),C('截取最荒诞的一段反讽','赢一小时热搜，输掉半个议题','rumor',-10,'switchboard',3,'截图正在扩散',null,{amber:-5})],'scene-hotel'),
switchboard:S('第二章 / 热搜调度台','数据员','热搜第 1 名：爱情。第 2 名：钱。第 3 名：一张像素极低的截图。<br><br>数据员把三块屏幕推到你面前："同一个话题，有三种燃料。你想先拆哪一桶？"',[C('追最早的截图源头','截图不是证据，源头才是问题','procedure',8,'screenshot',5,'源头定位完成'),C('联系"小说"的发布者','问动机，不等于获得事实','self',2,'call',3,'对方接了电话'),C('压掉负面词条','让它短暂消失，通常会更大声回来','rumor',-8,'call',5,'词条消失，代价在涨')],'scene-server'),
screenshot:S('第三章 / 截图的祖先','数据员','最早的截图来自一个只存活 27 分钟的账号。它先发给了营销群，再被"路人"搬运，最后才抵达大众。<br><br>最荒诞的是：文件创建时间早于所谓"突发新闻"六小时。',[C('保全元数据，交律师','让证据沿着正确的慢路走','procedure',12,'call',5,'证据链已固化',0,{gain:'metadata'}),C('立刻公布时间差','真相会被剪成更好转发的图','rumor',-2,'call',3,'时间差成了新一轮热搜')],'scene-server'),
call:S('第四章 / 未接来电','零号','匿名电话接通。对方自称"零号"，声线疲惫又笃定：<br>"我没有要她说出真相。我只是把我经历过的，写成小说。"<br><br>你问："那为什么同一天递交程序文件？"电话那头沉默。',[C('追问"小说"与程序的关系','把矛盾留在录音里','procedure',10,'lounge',5,'矛盾被录音留下',0,{gain:'recording'},{zero:3,lawyer:2}),C('让琥珀亲自接电话','当事人有权拒绝你的脚本','self',7,'lounge',3,'对方撤回了一句话',null,{amber:5,zero:-3}),C('录音剪成预告片','把沉默也做成悬念','rumor',-9,'lounge',4,'预告片上传成功',null,{zero:-5})],'scene-hotel'),
lounge:function(){
  return S('第五章 / 第七码头计划','琥珀','琥珀说，小说里所有最刺眼的部分都被归进一个代号：第七码头。<br>它像一份共同计划，也像一份随时可以重写的交易。谁都没说它究竟是什么。<br><br>"我不解释私密细节，"她说，"不是因为默认了，而是因为我的人生不是供人验货的商品。"',[C('起草"边界声明"','声明不解释私密，只说明权利','self',10,'ledger',2,'声明被律师润色'),C('补一份逐条否认','逐条回应会制造更多可复制标题','self',-2,'ledger',6,'标题生成器开起来了')].concat(state.trust.amber>=60?[C('让琥珀写她想说的话','信任度足够时，她会主动执笔','self',9,'ledger',1,'她把边界声明写成了日记',null,{amber:5})]:[]),'scene-hotel');
},
ledger:S('第六章 / 情感预算表','会计','桌上摆着一张被媒体称为"爱情账单"的文件。你发现它并不是账本，而是一份内部预算模板：餐厅、机票、礼物、律师、热搜、危机预案。<br><br>最末一栏叫：<br>"人物离场后的叙事资产。"',[C('锁定模板的创建人','先确认它是谁写的','procedure',10,'archive',5,'模板溯源完成',0,{gain:'template'}),C('把这句发到网上','杀伤力很大，语境也会一起死亡','rumor',-5,'archive',2,'语境和你一起死了')],'scene-server'),
archive:S('第七章 / 四十七页信任报告','旁白','匿名网盘里有一份《琥珀风险报告》：四十七页，封面写"信任模型"。文件末页却有系统注释：<br>"人物资料待补；传播预案已完成。"<br><br>原来被审计的不是琥珀，是公众的注意力。',[C('只发布可验证的页码与元数据','不替观众写结论','procedure',12,'oracle',4,'可验证页码已发布'),C('公开整份文件','资料会被撕成支持各方的碎片','rumor',-1,'oracle',5,'文件被撕成双方武器')],'scene-server'),
oracle:function(){
  var d=state.aiDebt;
  var note='';
  if(d>=5){
    note='<br><br><em class="ai-voice-inline">[系统提示] 你已累计将 '+d+' 项决定权交由 AI 代理。AI 在你不知道的地方替你做出了 '+Math.floor(d/2)+' 次选择。是否继续？</em>';
  }else if(d>=3){
    note='<br><br><em class="ai-voice-inline">[系统提示] 本次建议前请确认：你已 '+d+' 次未由人类做出最终决定。这将被记入案卷。</em>';
  }
  // Tier 2B: 如果有录音，提供「出示录音 + 自己列盲区」选项（消耗录音，跳过 AI）
  var burnChoice=state.evidence.indexOf('recording')>=0
    ?[C('出示录音，自己列出盲区','有录音就不用 AI 替人判断','procedure',8,'backstage',3,'你列出 AI 漏掉的三个矛盾点',0,{burn:'recording'})]
    :[];
  return S('第八章 / 甲骨文','甲骨文 AI',
    '零号把一段对话记录交给媒体，称自己曾向 AI 征求意见。你调用同一套模型，输入同一份小说，得到的建议是：<br>"不要付款。不要回应。把风险最小化。"<br><br>琥珀问："如果输入本身是一篇小说，AI 在替谁做决定？"'+note,
    burnChoice.concat([
      C('让 AI 列出输入的盲区','工具不能替人承担判断','ai',11,'backstage',3,'AI 列出了它不想列的',1),
      C('让 AI 写一篇更强的反击文','把算法当作更会说话的我方律师','ai',-8,'backstage',5,'AI 完成了初稿，你失去了选择',2)
    ]),
    'scene-server');
},
backstage:S('第九章 / 发布会后台','经纪人','距离直播还有 18 分钟。赞助商希望你们"情绪化一点"；律师希望你们"像一台打印机"；琥珀正在删掉自己的发言稿。<br><br>她说："所有人都在教我怎么扮演受害者，或者怎么扮演反派。"',[C('让她按自己的方式说','把话筒从策略表交还给人','self',12,'stage',2,'话筒回到她手里',null,{amber:5}),C('照律师稿逐字念','安全，但可能什么也没留下','procedure',5,'stage',3,'她在念，但她不是她',null,{lawyer:3,amber:-3}),C('临时加一段嘲讽','爽感会比事实跑得快','rumor',-7,'stage',1,'嘲讽比事实跑得快',null,{amber:-2})],'scene-stage'),
stage:S('第十章 / 镜港发布会','琥珀','镜头亮起。第一个问题果然是猎奇细节。<br><br>琥珀没有回答，而是把一枚写着"未审理"的金属牌放在台上：<br>"请把未经审理的故事留在故事里。你可以争一笔钱，不能起诉一个人该怎样被理解。"',[C('展示程序时间线','让所有人看清案件走到哪一步','procedure',10,'choir',3,'时间线被截图扩散'),C('展示传播预案的空白模板','让所有人看见热搜怎样被制造','self',9,'choir',4,'空白模板成为热搜'),C('关闭直播，不再提供素材','切断流量，也切断自己的话语','rumor',-3,'choir',2,'她切断了流量')],'scene-stage'),
choir:S('第十一章 / 弹幕合唱','旁白','弹幕分成两派，又很快变成三派、四派。有人要结论，有人要细节，有人第一次问：<br>"为什么一份程序文件，比一篇小说更难传播？"<br><br>数据员把控制台交给你。',[C('置顶"尚未实体审理"','给事实一个不讨喜的位置','procedure',8,'dawn',2,'事实有了不讨喜的位置'),C('置顶琥珀的边界声明','给人一个不必自证的出口','self',8,'dawn',2,'人有了不必自证的出口'),C('置顶最热的梗图','今晚所有人都会记住你','rumor',-10,'dawn',2,'今晚所有人都会记住你')],'scene-stage'),
dawn:S('第十二章 / 天亮前','琥珀','镜港快天亮了。白塔仍然没有判决；热搜已经开始寻找下一位主角。<br><br>琥珀问你："剪辑师，到了最后，你觉得我们赢了什么？"',[C('"我们没有替任何人下判决。"','把未知留给程序，把尊严留给人','procedure',9,'ending',2,'白塔的程序被尊重'),C('"我们把提词器关掉了一会儿。"','短暂夺回叙事，也已足够','self',8,'ending',2,'她抢回了 18 分钟'),C('"我们上了一次热搜。"','最容易计算，也最容易消失','rumor',-8,'ending',2,'最容易计算，也最容易消失')],'scene-stage'),
ending:function(){
  // Tier 2D: 隐藏结局 —「白塔的钟声」——程序正义的真正胜利
  // 条件：证据 ≥ 3 + AI 债务 = 0 + 分数 ≥ 80 + 程序选项 ≥ 5
  if(state.evidence.length>=3&&state.aiDebt===0&&state.score>=80&&state.kind.procedure>=5){
    var d=S('终章 / 第七码头', '旁白',
      '<span class="ending-title hidden-ending">结局特 / 白塔的钟声</span><br>'+
      '你手里有完整的三件证据。你没有动用过 AI。程序时间线、传播预案、原始录音，已经整整齐齐地摆在白塔的案卷里。<br><br>'+
      '法庭不是被舆论左右的。也不是被 AI 加速的。它被一份完整的事实推着，缓慢地、不可逆地走到了它的位置。<br><br>'+
      '第七码头的灯熄灭的时候，白塔的钟敲了。镜港第一次听见——"未审理"不是一句话，是一个过程。'+
      '<br><br>剩余时间：'+formatTime(state.time)+' / 最终叙事可信度：'+state.score+' / 100 / 证据：'+state.evidence.length+' 件 / AI 代理权：0',
      [C('重新开始','另一条路径，会看到另一种镜港','self',0,'start',0,'时间倒回 72:00')],
      'scene-ending');
    d.audioKey='ending_hidden';
    return d;
  }
  var title,body,audioKey;
  if(state.aiDebt>=3){title='结局零 / 算法声明';body='庭审是结束了。但新闻发布会上发言的不是琥珀——是一份被署了你名字的算法声明。<br><br>她的边界由你交给了工具。工具按它的方式完成了任务。你拿到了热度，工具拿到了署名权。';audioKey='ending_a';}
  else if(state.score>=78&&state.kind.procedure>=4){title='结局一 / 没有故事的人';body='白塔的程序缓慢推进，热搜终于失去燃料。琥珀没有赢得一场口水战；她只是拒绝被写成任何一种方便转发的人。<br><br>第七码头的灯熄灭时，镜港第一次把"未审理"读成完整的四个字。';audioKey='ending_b';}
  else if(state.score<45||state.kind.rumor>=4){title='结局二 / 鲨鱼也会哭';body='你们都赢得了热搜。小说被剪成证词，证据被剪成梗图，所有人都在自己的版本里胜诉。<br><br>几周后，没有人记得争议是什么；镜港只记得那晚的流量创下纪录。';audioKey='ending_c';}
  else{title='结局三 / 草稿箱未删除';body='你公开了流量预案的空白模板。人们突然看见，每一场"偶然爆发"的舆论，都预留了主角、反派、反转和广告位。<br><br>没有人因此变得无辜，但第一次，有人看见了剧本的提词器。';audioKey='ending_d';}
  var d2=S('终章 / 第七码头', '旁白','<span class="ending-title">'+title+'</span><br>'+body+'<br><br>剩余时间：'+formatTime(state.time)+' / 最终叙事可信度：'+state.score+' / 100',[C('重新开始','另一条路径，会看到另一种镜港','self',0,'start',0,'时间倒回 72:00')],'scene-ending');
  d2.audioKey=audioKey;
  return d2;
}
};

// === Tier 2A: 危机事件 — 时间轴触发，绕开常规场景树 ===
var crisisEvents={
  'ev-60':S('危机 / 60 小时','监控台',
    '三个头部营销号同时发出同一张截图。热搜前三都被它占领。原始截图正在被快速二创。',
    [C('程序回应','让律师发官方声明','procedure',6,'__resume__',6,'律师声明已发'),
     C('当事人回应','让琥珀自己发声','self',4,'__resume__',5,'琥珀自己发声了'),
     C('沉默观察','让热搜自己过气','rumor',-3,'__resume__',4,'沉默被算法配音')],
    'scene-server'),
  'ev-48':S('危机 / 48 小时','经纪人',
    '琥珀在一次直播中被问到小说里的某个细节。她的表情在两秒内塌了。直播持续了十二分钟。录像正在被二创。',
    [C('切断直播','保护她，但流量会反噬','rumor',-5,'__resume__',4,'直播已断'),
     C('让经纪人发通稿','技术性回应，避免继续失控','procedure',2,'__resume__',5,'通稿已发'),
     C('让它发生','不干预，让素材自己发酵','self',-2,'__resume__',5,'十二分钟成了新素材')],
    'scene-hotel'),
  'ev-36':S('危机 / 36 小时','数据员',
    '那个只活了 27 分钟的账号被人肉出来了——是某营销公司的实习生。媒体开始追问："谁买了流量？"',
    [C('配合媒体追查','让律师配合，把水搅浑','procedure',7,'__resume__',7,'律师配合了媒体',0,{gain:'playbook'}),
     C('让 AI 整理时间线','工具替人做决定，债务+1','ai',3,'__resume__',5,'AI 整理了时间线',1),
     C('沉默','不回应，让子弹飞一会','rumor',-4,'__resume__',4,'沉默被解读为默认')],
    'scene-server'),
  'ev-24':S('危机 / 24 小时','书记员',
    '法院送达传票：48 小时内提交答辩。律师说："这是分水岭。做了就是做了，没做就是没做。"',
    [C('正式答辩','按程序走，慢但是安全','procedure',9,'__resume__',8,'答辩状已提交'),
     C('申请延期','争取时间，但对方可能反击','procedure',2,'__resume__',5,'延期被驳回'),
     C('让 AI 草拟','快，但署名是你的','ai',1,'__resume__',5,'AI 写完了，你失去了选择',1)],
    'scene-court'),
  'ev-12':S('危机 / 12 小时','经纪人',
    '零号公开发声："我只是写了我经历过的事。"发布会前十二小时。他在抢叙事。',
    [C('程序对决','按准备好的答辩走','procedure',8,'__resume__',5,'程序对程序的对抗'),
     C('让琥珀自己说','她有权决定怎么回应','self',9,'__resume__',4,'琥珀说了她想说的'),
     C('让 AI 写反击文','快，但署名是 AI','ai',-2,'__resume__',3,'AI 反击文已被识破',2)],
    'scene-stage')
};

// 每个危机事件按 time 阈值触发，threshold = 该事件的 time
var crisisThresholds=[
  {key:'ev-60',time:60},
  {key:'ev-48',time:48},
  {key:'ev-36',time:36},
  {key:'ev-24',time:24},
  {key:'ev-12',time:12}
];

function checkCrisisEvent(){
  if(!state||!state.handledEvents)return null;
  for(var i=0;i<crisisThresholds.length;i++){
    var t=crisisThresholds[i];
    if(state.handledEvents.indexOf(t.key)===-1&&state.time<=t.time)return t.key;
  }
  return null;
}

function show(id){
  currentSceneId=id;
  // 失败态拦截
  if(state.failure){renderFailure();return;}
  // 结局入场 sting（在场景渲染前触发，让"这是终局"的感觉先到）
  if(id==='ending')playEndingSting();
  // 危机事件路由
  var d;
  if(typeof id==='string'&&id.indexOf('crisis:')===0){
    var evKey=id.slice(7);
    if(crisisEvents[evKey]){
      d=crisisEvents[evKey];
      game.classList.add('crisis-mode');
      playCrisisAlert();
    }else{
      d=scenes.start;
    }
  }else{
    d=typeof scenes[id]==='function'?scenes[id]():scenes[id];
    game.classList.remove('crisis-mode');
  }
  // 上一选择即时反馈
  var lastEffect=state.sideEffects.length?state.sideEffects[state.sideEffects.length-1]:null;
  var lastKind=state.history.length?state.history[state.history.length-1]:'';
  var isAi=lastKind==='ai';
  var effectHtml=lastEffect?'<div class="side-effect'+(isAi?' ai-voice':'')+'">› '+lastEffect+(state.aiDebt>0?' <span class="ai-debt-badge">AI 代理权 × '+state.aiDebt+'</span>':'')+'</div>':'';
  el.text.innerHTML=effectHtml+d.text;
  // 保留 crisis-mode 标记（className= 会整体覆盖）
  game.className=d.skin+(state.activeCrisis?' crisis-mode':'');
  el.chapter.textContent=d.chapter;
  el.speaker.textContent=d.speaker;
  // 立绘渲染：根据 speaker 切换图片和信任度边框
  var portraitFile=portraits[d.speaker];
  if(portraitFile&&el.portrait){
    el.stage.classList.add('has-portrait');
    el.portraitImg.src=portraitFile;
    el.portraitImg.alt=d.speaker;
    el.portraitName.textContent=d.speaker;
    el.portrait.style.display='flex';
    var tKey=speakerToTrust[d.speaker];
    var tVal=tKey&&state.trust?state.trust[tKey]:null;
    var trustCls=(tVal===null)?'':(tVal>=70?' trust-high':(tVal<30?' trust-low':''));
    el.portrait.className='portrait-card'+trustCls;
  }else if(el.portrait){
    el.stage.classList.remove('has-portrait');
    el.portrait.style.display='none';
  }
  el.score.textContent=state.score;
  el.bar.style.width=state.score+'%';
  // 倒计时
  if(el.clock){
    el.clock.textContent=formatTime(state.time);
    el.clock.className=state.time<=8?'critical':(state.time<=24?'warning':'');
  }
  // 来源标签
  var last=state.history.length?state.history[state.history.length-1]:'';
  var names={procedure:'最近选择：程序文件',self:'最近选择：当事人回应',rumor:'最近选择：传播截图',ai:'最近选择：AI 建议'};
  el.source.textContent=names[last]||'尚未选择信息来源';
  // 选项
  while(el.choices.firstChild)el.choices.removeChild(el.choices.firstChild);
  for(var i=0;i<d.choices.length;i++)(function(c){
    // Tier 2B: require 证据检查，没持有则跳过
    if(c.ev&&c.ev.require&&state.evidence.indexOf(c.ev.require)===-1)return;
    var b=document.createElement('button');
    b.className='choice'+(c.aiDebt?' ai-afford':'')+(c.ev&&c.ev.burn?' ev-burn':'');
    var evTag=(c.ev&&c.ev.gain)?' · <span class="ev-tag">+证据</span>':'';
    var burnTag=(c.ev&&c.ev.burn)?' · <span class="ev-tag ev-burn-tag">−证据</span>':'';
    b.innerHTML=c.label+'<small>'+c.hint+(c.cost>0?' · −'+c.cost+'h':'')+(c.aiDebt?' · +代理权':'')+evTag+burnTag+'</small>';
    b.onclick=function(){pick(c);};
    el.choices.appendChild(b);
  })(d.choices[i]);
  // Tier 2B: 证据行渲染
  if(el.evidence){
    if(state.evidence.length){
      var chips=state.evidence.map(function(id){return '<span class="ev-chip">'+evName(id)+'</span>';}).join('');
      el.evidence.innerHTML='<span class="ev-label">证 据</span>'+chips;
    }else{
      el.evidence.innerHTML='<span class="ev-label">证 据</span><span class="ev-empty">暂未持有</span>';
    }
  }
  // Tier 2C: NPC 信任度行
  if(el.trust&&state.trust){
    var tNames={amber:'琥珀',zero:'零号',lawyer:'律师',agent:'经纪人'};
    var html='<span class="ev-label">信 任</span>';
    for(var npc in state.trust){
      var v=state.trust[npc];
      var col=v>=70?'#80ffd0':(v<30?'#ff8a8a':'#f5ce72');
      html+='<span class="trust-chip" style="color:'+col+'">'+tNames[npc]+' '+v+'</span>';
    }
    el.trust.innerHTML=html;
  }
  // 配音：按 d.audioKey 或 currentSceneId 选 mp3，路径 assets/voice/<speaker_key>/<id>.mp3
  playVoiceForScene(d);
}

// 配音播放
function playVoiceForScene(d){
  if(!voiceEnabled||!el.voice)return;
  var spkKey=speakerToVoice[d.speaker];
  if(!spkKey)return;
  var id=d.audioKey||currentSceneId;
  if(!id)return;
  var src='assets/voice/'+spkKey+'/'+id+'.mp3';
  if(el.voice.src.endsWith(src)){el.voice.play().catch(function(){});return;}
  el.voice.src=src;
  el.voice.currentTime=0;
  el.voice.play().catch(function(){});
}

function stopVoice(){
  if(el.voice){el.voice.pause();el.voice.currentTime=0;}
}

function formatTime(hours){
  var h=Math.floor(hours);
  var m=Math.round((hours-h)*60);
  if(m===60){h++;m=0;}
  return h+':'+(m<10?'0':'')+m;
}

// 分数条脉冲：每次分数变化时 0.6s 高亮+发光，提示"刚刚那一下动了"
function pulseScoreBar(){
  if(!el.bar)return;
  el.bar.classList.remove('pulse');
  void el.bar.offsetWidth; // 强制 reflow 重新触发动画
  el.bar.classList.add('pulse');
  setTimeout(function(){el.bar.classList.remove('pulse');},650);
}

function showScoreBurst(kind,text){
  var b=document.createElement('div');
  b.className='score-burst '+kind;
  var t=document.createElement('div');
  t.className='burst-text';
  t.textContent=text;
  b.appendChild(t);
  document.body.appendChild(b);
  setTimeout(function(){b.remove();},kind==='gold'?2400:2000);
  if(kind==='gold')playBurstChord();
  else playBurstDistort();
}

function renderFailure(){
  var f=state.failure;
  var title,stamp,body;
  if(f==='lost'){title='叙事失控';stamp='失控归档';body='你失去了对叙事的所有控制。\n\n热搜的燃料烧穿了你的底线。不是程序在管你，是你连程序都来不及抄。';}
  else if(f==='timeout'){title='错过终局';stamp='超时归档';body='72 小时已到。\n\n白塔的程序已经走过关键节点。你不是输了——你是没赶上。';}
  else{title='代理权让渡';stamp='AI 接管归档';body='你把决定权交给了工具。工具按它的方式写完了剩下的剧情。\n\n庭审是结束了。但新闻发布会上发言的不是琥珀——是一份被署了你名字的算法声明。';}
  document.getElementById('failure-stamp').textContent=stamp;
  document.getElementById('failure-title').textContent=title;
  document.getElementById('failure-body').innerHTML=body.replace(/\n\n/g,'<br><br>');
  document.getElementById('failure-score').textContent=state.score;
  document.getElementById('failure-time').textContent=formatTime(state.time);
  el.failure.hidden=false;
  playFailureSound();
}

function playBurstChord(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  // 1. Sub-bass BOOM @ t=0（80→40Hz 滑落，命中"压"的瞬间）
  var boom=audioCtx.createOscillator();
  boom.type='sine';
  boom.frequency.setValueAtTime(85,now);
  boom.frequency.exponentialRampToValueAtTime(40,now+0.4);
  var boomG=audioCtx.createGain();
  boomG.gain.setValueAtTime(.0001,now);
  boomG.gain.exponentialRampToValueAtTime(.22,now+0.02);
  boomG.gain.exponentialRampToValueAtTime(.0001,now+0.7);
  boom.connect(boomG);boomG.connect(audioCtx.destination);
  boom.start(now);boom.stop(now+0.8);
  // 2. 高频 noise punch @ t=0（清脆的开场）
  var noiseLen=audioCtx.sampleRate*0.06;
  var noiseBuf=audioCtx.createBuffer(1,noiseLen,audioCtx.sampleRate);
  var nd=noiseBuf.getChannelData(0);
  for(var i=0;i<noiseLen;i++)nd[i]=(Math.random()*2-1)*Math.exp(-i/(noiseLen*0.25));
  var n=audioCtx.createBufferSource();n.buffer=noiseBuf;
  var nF=audioCtx.createBiquadFilter();nF.type='bandpass';nF.frequency.value=3500;nF.Q.value=2;
  var nG=audioCtx.createGain();nG.gain.value=0.14;
  n.connect(nF);nF.connect(nG);nG.connect(audioCtx.destination);
  n.start(now);
  // 3. Cmaj9 级进和弦 @ t=60ms（C E G B + 高八度 E，逐个上推 25ms = 跑动旋律感）
  [261.63,329.63,392.00,493.88,659.25].forEach(function(freq,i){
    var o=audioCtx.createOscillator();
    o.type='sine';o.frequency.value=freq;
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,now+0.06+i*0.025);
    g.gain.exponentialRampToValueAtTime(.045,now+0.18+i*0.025);
    g.gain.exponentialRampToValueAtTime(.0001,now+1.6);
    o.connect(g);g.connect(audioCtx.destination);
    o.start(now+0.06+i*0.025);o.stop(now+1.7);
  });
  // 4. 钟磬泛音 @ t=400ms（高频闪烁，撑起"扬"的余韵）
  var bell=audioCtx.createOscillator();
  bell.type='sine';bell.frequency.value=1318.51;
  var bellG=audioCtx.createGain();
  bellG.gain.setValueAtTime(.0001,now+0.4);
  bellG.gain.exponentialRampToValueAtTime(.025,now+0.55);
  bellG.gain.exponentialRampToValueAtTime(.0001,now+1.4);
  bell.connect(bellG);bellG.connect(audioCtx.destination);
  bell.start(now+0.4);bell.stop(now+1.5);
  // 5. 低频铺底 @ t=100ms（撑住整个爆点的"厚度"，2s 淡出）
  var pad=audioCtx.createOscillator();
  pad.type='sine';pad.frequency.value=130.81;
  var padG=audioCtx.createGain();
  padG.gain.setValueAtTime(.0001,now+0.1);
  padG.gain.exponentialRampToValueAtTime(.025,now+0.5);
  padG.gain.exponentialRampToValueAtTime(.0001,now+2.0);
  pad.connect(padG);padG.connect(audioCtx.destination);
  pad.start(now+0.1);pad.stop(now+2.1);
}

function playBurstDistort(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  // 1. Sub-bass growl（60→35Hz 滑落，低通）
  var growl=audioCtx.createOscillator();
  growl.type='sawtooth';
  growl.frequency.setValueAtTime(60,now);
  growl.frequency.exponentialRampToValueAtTime(35,now+0.5);
  var gF=audioCtx.createBiquadFilter();gF.type='lowpass';gF.frequency.value=220;
  var growlG=audioCtx.createGain();
  growlG.gain.setValueAtTime(.0001,now);
  growlG.gain.exponentialRampToValueAtTime(.15,now+0.02);
  growlG.gain.exponentialRampToValueAtTime(.0001,now+0.8);
  growl.connect(gF);gF.connect(growlG);growlG.connect(audioCtx.destination);
  growl.start(now);growl.stop(now+0.9);
  // 2. 不协和音簇 @ t=30ms（小三度堆叠，制造"刺耳"）
  [233.08,261.63,311.13].forEach(function(freq,i){
    var o=audioCtx.createOscillator();
    o.type='square';o.frequency.value=freq;
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,now+0.03+i*0.015);
    g.gain.exponentialRampToValueAtTime(.04,now+0.1+i*0.015);
    g.gain.exponentialRampToValueAtTime(.0001,now+0.6);
    o.connect(g);g.connect(audioCtx.destination);
    o.start(now+0.03+i*0.015);o.stop(now+0.7);
  });
  // 3. 高频噪声（更长的失真尾巴，0.5s）
  var len=audioCtx.sampleRate*0.5;
  var buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
  var d=buf.getChannelData(0);
  for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/(len*0.4));
  var n=audioCtx.createBufferSource();n.buffer=buf;
  var f=audioCtx.createBiquadFilter();f.type='highpass';f.frequency.value=500;f.Q.value=3;
  var g=audioCtx.createGain();g.gain.value=0.18;
  n.connect(f);f.connect(g);g.connect(audioCtx.destination);
  n.start(now);
}

function playFailureSound(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  // 1. Sub-bass 落印（80Hz 正弦，0.4s 衰减）—— 印章砸到纸的物理冲击
  var thud=audioCtx.createOscillator();
  thud.type='sine';thud.frequency.value=80;
  var thudG=audioCtx.createGain();
  thudG.gain.setValueAtTime(.0001,now);
  thudG.gain.exponentialRampToValueAtTime(.18,now+.015);
  thudG.gain.exponentialRampToValueAtTime(.0001,now+.45);
  thud.connect(thudG);thudG.connect(audioCtx.destination);
  thud.start(now);thud.stop(now+.5);
  // 2. 印章金属边 click（2.5kHz triangle，30ms）
  var click=audioCtx.createOscillator();
  click.type='triangle';click.frequency.value=2500;
  var clickG=audioCtx.createGain();
  clickG.gain.setValueAtTime(.0001,now);
  clickG.gain.exponentialRampToValueAtTime(.08,now+.002);
  clickG.gain.exponentialRampToValueAtTime(.0001,now+.04);
  click.connect(clickG);clickG.connect(audioCtx.destination);
  click.start(now);click.stop(now+.05);
  // 3. 低频金属环（220Hz square + lowpass 600Hz，0.8s 衰减）—— 盖完后残留
  var ring=audioCtx.createOscillator();
  ring.type='square';ring.frequency.value=220;
  var ringF=audioCtx.createBiquadFilter();
  ringF.type='lowpass';ringF.frequency.value=600;ringF.Q.value=2;
  var ringG=audioCtx.createGain();
  ringG.gain.setValueAtTime(.0001,now+.05);
  ringG.gain.exponentialRampToValueAtTime(.04,now+.12);
  ringG.gain.exponentialRampToValueAtTime(.0001,now+.85);
  ring.connect(ringF);ringF.connect(ringG);ringG.connect(audioCtx.destination);
  ring.start(now+.05);ring.stop(now+.9);
}

// 选择瞬间的"咬合"音——按 kind 区分；强度跟 |delta| 走
function playChoiceSting(kind,delta){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  var intensity=Math.max(.45,Math.min(1.25,Math.abs(delta)/10));
  if(kind==='procedure'){
    // 程序文件：triangle C+E♭ 切音（filing 的"咔哒"感）
    [261.63,311.13].forEach(function(f,i){
      var o=audioCtx.createOscillator();
      o.type='triangle';o.frequency.value=f;
      var g=audioCtx.createGain();
      g.gain.setValueAtTime(.0001,now+i*.03);
      g.gain.exponentialRampToValueAtTime(.055*intensity,now+.01+i*.03);
      g.gain.exponentialRampToValueAtTime(.0001,now+.22+i*.03);
      o.connect(g);g.connect(audioCtx.destination);
      o.start(now+i*.03);o.stop(now+.25+i*.03);
    });
  }else if(kind==='self'){
    // 当事人回应：单音 440Hz sine，400ms 暖色收尾
    var o=audioCtx.createOscillator();
    o.type='sine';o.frequency.value=440;
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,now);
    g.gain.exponentialRampToValueAtTime(.045*intensity,now+.04);
    g.gain.exponentialRampToValueAtTime(.0001,now+.42);
    o.connect(g);g.connect(audioCtx.destination);
    o.start(now);o.stop(now+.45);
  }else if(kind==='rumor'){
    // 传播截图：bandpass 1500Hz noise，150ms glitch
    var len=audioCtx.sampleRate*.15;
    var buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
    var d=buf.getChannelData(0);
    for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/(len*.3));
    var n=audioCtx.createBufferSource();n.buffer=buf;
    var f=audioCtx.createBiquadFilter();
    f.type='bandpass';f.frequency.value=1500;f.Q.value=4;
    var g=audioCtx.createGain();g.gain.value=.085*intensity;
    n.connect(f);f.connect(g);g.connect(audioCtx.destination);
    n.start(now);
  }else if(kind==='ai'){
    // AI 建议：方波 880+1760+2640 三层，300ms 金属感
    [880,1760,2640].forEach(function(f,i){
      var o=audioCtx.createOscillator();
      o.type='square';o.frequency.value=f;
      var g=audioCtx.createGain();
      g.gain.setValueAtTime(.0001,now);
      g.gain.exponentialRampToValueAtTime(.02*intensity,now+.01);
      g.gain.exponentialRampToValueAtTime(.0001,now+.32);
      o.connect(g);g.connect(audioCtx.destination);
      o.start(now);o.stop(now+.35);
    });
  }
}

// 证据获得：双音小铃铛（E5 + B5）+ 顶部高光 sine，0.4s
function playEvidenceGain(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  [659.25,987.77].forEach(function(f,i){
    var o=audioCtx.createOscillator();
    o.type='sine';o.frequency.value=f;
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,now+i*.05);
    g.gain.exponentialRampToValueAtTime(.05,now+.02+i*.05);
    g.gain.exponentialRampToValueAtTime(.0001,now+.45+i*.05);
    o.connect(g);g.connect(audioCtx.destination);
    o.start(now+i*.05);o.stop(now+.5+i*.05);
  });
}

// 证据消耗：低一阶的"封存"音（A4 + E5），更短促
function playEvidenceBurn(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  [440,659.25].forEach(function(f,i){
    var o=audioCtx.createOscillator();
    o.type='triangle';o.frequency.value=f;
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,now+i*.04);
    g.gain.exponentialRampToValueAtTime(.04,now+.015+i*.04);
    g.gain.exponentialRampToValueAtTime(.0001,now+.25+i*.04);
    o.connect(g);g.connect(audioCtx.destination);
    o.start(now+i*.04);o.stop(now+.3+i*.04);
  });
}

// 证据行视觉脉冲
function pulseEvidenceRow(){
  if(!el.evidence)return;
  el.evidence.classList.remove('pulse');
  void el.evidence.offsetWidth;
  el.evidence.classList.add('pulse');
  setTimeout(function(){el.evidence.classList.remove('pulse');},650);
}

// 结局入场 sting：Cmaj7 分解——给"你压住了场面"的最终回报
function playEndingSting(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  // 4 个音错开 50ms 走上去，再一起落下来
  [261.63,329.63,392.00,493.88].forEach(function(f,i){
    var o=audioCtx.createOscillator();
    o.type='triangle';o.frequency.value=f;
    var g=audioCtx.createGain();
    var t=now+i*.05;
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(.045,t+.04);
    g.gain.exponentialRampToValueAtTime(.0001,t+2.1);
    o.connect(g);g.connect(audioCtx.destination);
    o.start(t);o.stop(t+2.2);
  });
  // 顶部 E6 钟磬（1318Hz，2s 收）
  var bell=audioCtx.createOscillator();
  bell.type='sine';bell.frequency.value=1318.51;
  var bellG=audioCtx.createGain();
  bellG.gain.setValueAtTime(.0001,now+.2);
  bellG.gain.exponentialRampToValueAtTime(.022,now+.4);
  bellG.gain.exponentialRampToValueAtTime(.0001,now+2.2);
  bell.connect(bellG);bellG.connect(audioCtx.destination);
  bell.start(now+.2);bell.stop(now+2.3);
}

// 危机事件警示音：两声高频警报 + 低频底鼓，0.5s 整体
function playCrisisAlert(){
  if(!audioCtx)return;
  var now=audioCtx.currentTime;
  // 警报 beep 1 @ t=0
  var b1=audioCtx.createOscillator();
  b1.type='square';b1.frequency.value=880;
  var b1G=audioCtx.createGain();
  b1G.gain.setValueAtTime(.0001,now);
  b1G.gain.exponentialRampToValueAtTime(.05,now+.005);
  b1G.gain.exponentialRampToValueAtTime(.0001,now+.08);
  b1.connect(b1G);b1G.connect(audioCtx.destination);
  b1.start(now);b1.stop(now+.1);
  // 警报 beep 2 @ t=0.12
  var b2=audioCtx.createOscillator();
  b2.type='square';b2.frequency.value=1100;
  var b2G=audioCtx.createGain();
  b2G.gain.setValueAtTime(.0001,now+.12);
  b2G.gain.exponentialRampToValueAtTime(.06,now+.125);
  b2G.gain.exponentialRampToValueAtTime(.0001,now+.2);
  b2.connect(b2G);b2G.connect(audioCtx.destination);
  b2.start(now+.12);b2.stop(now+.22);
  // 低频底鼓（65Hz sine，0.4s 衰减）—— 强调"事件级别"
  var thud=audioCtx.createOscillator();
  thud.type='sine';thud.frequency.value=65;
  var thudG=audioCtx.createGain();
  thudG.gain.setValueAtTime(.0001,now);
  thudG.gain.exponentialRampToValueAtTime(.12,now+.02);
  thudG.gain.exponentialRampToValueAtTime(.0001,now+.4);
  thud.connect(thudG);thudG.connect(audioCtx.destination);
  thud.start(now);thud.stop(now+.45);
}

var audioCtx=null,audioTimer=null,ambientAudio=null;
function playAmbient(){
  if(!ambientAudio){
    ambientAudio=new Audio('assets/noir_ambient_01.mp3');
    ambientAudio.loop=true;
    ambientAudio.volume=0.4;
  }
  var p=ambientAudio.play();
  if(p&&p.then){p.then(function(){audioTimer=1;}).catch(function(){});}
}
function stopAmbient(){if(ambientAudio){ambientAudio.pause();}audioTimer=null;}
function playClick(){
  if(!audioCtx){audioCtx=new (window.AudioContext||window.webkitAudioContext)();}
  if(audioCtx.state==='suspended'){audioCtx.resume();}
  var now=audioCtx.currentTime;
  var len=audioCtx.sampleRate*0.04;
  var buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
  var d=buf.getChannelData(0);
  for(var i=0;i<len;i++){d[i]=(Math.random()*2-1)*Math.exp(-i/(len*0.25));}
  var n=audioCtx.createBufferSource();n.buffer=buf;
  var f=audioCtx.createBiquadFilter();f.type='bandpass';f.frequency.value=1800;f.Q.value=3;
  var ng=audioCtx.createGain();ng.gain.value=0.08;
  n.connect(f);f.connect(ng);ng.connect(audioCtx.destination);
  n.start(now);
  var t=audioCtx.createOscillator();t.type='sine';t.frequency.value=620;
  var tg=audioCtx.createGain();
  tg.gain.setValueAtTime(.0001,now);
  tg.gain.exponentialRampToValueAtTime(.13,now+.004);
  tg.gain.exponentialRampToValueAtTime(.0001,now+.06);
  t.connect(tg);tg.connect(audioCtx.destination);
  t.start(now);t.stop(now+.07);
}
document.addEventListener('click',function(e){
  playClick();
  var r=document.createElement('div');
  r.className='click-ripple';
  r.style.left=e.clientX+'px';
  r.style.top=e.clientY+'px';
  document.body.appendChild(r);
  setTimeout(function(){r.remove();},600);
});
document.getElementById('sound').onclick=function(){var b=this;if(audioTimer){stopAmbient();b.setAttribute('aria-pressed','false');b.textContent='♪ 环境音';}else{playAmbient();b.setAttribute('aria-pressed','true');b.textContent='♫ 环境音';}};
document.getElementById('voice-toggle').onclick=function(){var b=this;voiceEnabled=!voiceEnabled;if(!voiceEnabled){stopVoice();b.setAttribute('aria-pressed','false');b.textContent='🔇 静音';}else{b.setAttribute('aria-pressed','true');b.textContent='🎙 配音';}};
document.getElementById('restart').onclick=function(){stopVoice();reset();};
document.getElementById('failure-restart').onclick=reset;
reset();
