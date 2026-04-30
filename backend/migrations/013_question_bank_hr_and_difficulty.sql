-- Migration 013: HR questions + difficulty spread + question_seen table
-- Apply via: Supabase SQL Editor or psql

-- ── 1. Expand cs_pillar CHECK to allow System Design (already in schema but constraint may block it)
ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS question_bank_cs_pillar_check;
ALTER TABLE question_bank ADD CONSTRAINT question_bank_cs_pillar_check
  CHECK (cs_pillar = ANY (ARRAY['OS','DBMS','CN','OOP','DSA','System Design']));

-- ── 2. Spread difficulty across the 125 existing CS questions ──────────────
-- Level 1 (easiest concepts — definitions, basics)
UPDATE question_bank SET difficulty = 1, elo_difficulty = 800
WHERE round_type = 'technical'
  AND subtopic ILIKE ANY(ARRAY['%Intro%','%Basics%','%Process Basics%','%Thread Basics%',
                                '%Introduction%','%Overview%','%Kernel Interface%',
                                '%OS Basics%','%SQL Basics%','%OOP Basics%',
                                '%What is%','%Definitions%']);

-- Level 2 stays as-is for questions not matched above (already 1000)

-- Level 3 (intermediate — mechanisms, comparisons)
UPDATE question_bank SET difficulty = 3, elo_difficulty = 1100
WHERE round_type = 'technical'
  AND elo_difficulty = 1000
  AND subtopic ILIKE ANY(ARRAY['%Synchronization%','%Scheduling%','%Transaction%',
                                '%Normalization%','%Indexing%','%Joins%',
                                '%TCP%','%HTTP%','%Polymorphism%','%Inheritance%',
                                '%Sorting%','%Searching%','%Hashing%',
                                '%Context Switch%','%Virtual Memory%']);

-- Level 4 (hard — design, trade-offs, advanced)
UPDATE question_bank SET difficulty = 4, elo_difficulty = 1300
WHERE round_type = 'technical'
  AND elo_difficulty = 1000
  AND subtopic ILIKE ANY(ARRAY['%Advanced%','%Design%','%Deadlock%','%Concurrency%',
                                '%ACID%','%Transaction Isolation%','%B-Tree%',
                                '%Load Balancing%','%CAP%','%Distributed%',
                                '%Memory Leak%','%Race Condition%']);

-- Level 5 (expert — edge cases, system design depth)
UPDATE question_bank SET difficulty = 5, elo_difficulty = 1500
WHERE round_type = 'technical'
  AND elo_difficulty = 1000
  AND subtopic ILIKE ANY(ARRAY['%Banker%','%IPC%','%TLB%','%Buffer Pool%',
                                '%Query Optimizer%','%Lock Manager%',
                                '%BGP%','%OSPF%','%Consensus%','%Paxos%']);

-- ── 3. question_seen table for user-level deduplication ──────────────────
CREATE TABLE IF NOT EXISTS public.question_seen (
  user_id     TEXT NOT NULL,
  question_id UUID NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  seen_at     TIMESTAMPTZ DEFAULT now(),
  score_received INTEGER,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_question_seen_user ON public.question_seen(user_id);

ALTER TABLE public.question_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see their own seen questions"
  ON public.question_seen FOR ALL
  USING (user_id = auth.uid()::text);

-- ── 4. HR question bank — 40 behavioral questions ────────────────────────
-- Format: round_type='hr', cs_pillar=NULL, topic=<hr_category>, difficulty 1-3

INSERT INTO public.question_bank
  (text, round_type, difficulty, elo_difficulty, topic, subtopic, expected_concepts,
   follow_up_shallow, follow_up_wrong, follow_up_strong, source)
VALUES

-- Leadership & Ownership (8 questions)
('Tell me about a time you took ownership of a project that was failing. What did you do and what was the outcome?',
 'hr', 2, 1000, 'Leadership & Ownership', 'Taking Initiative',
 '["ownership", "accountability", "STAR method", "outcome focus"]',
 'What specific actions did YOU take vs the team?',
 'Try to structure your answer: what was the situation, what did you specifically do, and what was the measurable outcome?',
 'How did you ensure the fix was sustainable and not just a short-term patch?'),

('Describe a situation where you had to make a difficult decision without all the information you needed.',
 'hr', 2, 1000, 'Leadership & Ownership', 'Decision Making',
 '["risk assessment", "decision under uncertainty", "data-driven thinking"]',
 'What data did you have and what were you missing?',
 'Walk me through the decision: what options did you consider and why did you choose that path?',
 'Looking back, would you have done anything differently? What did you learn?'),

('Give me an example of a time you set a goal and achieved it despite obstacles.',
 'hr', 1, 800, 'Leadership & Ownership', 'Goal Setting',
 '["goal setting", "persistence", "problem solving", "STAR method"]',
 'What was the specific goal and timeline?',
 'Can you walk me through what the obstacles were and the specific steps you took?',
 'How did achieving this goal impact your team or the broader organization?'),

('Tell me about a time you had to lead a team through a significant change or challenge.',
 'hr', 3, 1100, 'Leadership & Ownership', 'Change Leadership',
 '["change management", "stakeholder communication", "team morale", "leadership"]',
 'How many people were involved and what were the key challenges?',
 'Focus on what YOU did as a leader — how did you bring the team along?',
 'How did you measure whether the change was successful?'),

('Describe a time when you proactively identified and fixed a problem before it escalated.',
 'hr', 2, 1000, 'Leadership & Ownership', 'Proactivity',
 '["proactivity", "risk identification", "ownership", "initiative"]',
 'How did you identify the problem before others noticed?',
 'Walk me through the specific steps: how did you spot it, what did you do, what happened?',
 'How did this experience change how you approach monitoring or risk management?'),

('Tell me about the most challenging project you have worked on. What made it challenging and how did you handle it?',
 'hr', 2, 1000, 'Leadership & Ownership', 'Project Challenges',
 '["problem solving", "resilience", "technical challenge", "STAR method"]',
 'What specifically made it the most challenging vs others?',
 'Break it down: what was the challenge, what did you try, what worked?',
 'What would you do differently now with your current knowledge?'),

('Describe a time when you disagreed with your manager''s decision. How did you handle it?',
 'hr', 3, 1100, 'Leadership & Ownership', 'Upward Communication',
 '["respectful disagreement", "data-driven argument", "professional communication"]',
 'What was the disagreement about specifically?',
 'How did you express your disagreement — was it in private or public?',
 'What was the outcome and did your view change after hearing their reasoning?'),

('Tell me about a time you delivered results under tight deadlines.',
 'hr', 1, 800, 'Leadership & Ownership', 'Execution Under Pressure',
 '["time management", "prioritization", "delivery", "pressure handling"]',
 'What was the deadline and why was it tight?',
 'Walk me through how you managed your time and what trade-offs you made.',
 'How did you communicate progress and risks to stakeholders during crunch time?'),

-- Conflict Resolution (5 questions)
('Tell me about a time you had a conflict with a colleague. How did you resolve it?',
 'hr', 2, 1000, 'Conflict Resolution', 'Peer Conflict',
 '["conflict resolution", "communication", "empathy", "STAR method"]',
 'What was the root cause of the conflict?',
 'Focus on what actions YOU took to resolve it — not what the other person did wrong.',
 'What did you learn about yourself from this experience?'),

('Describe a situation where you had to work with someone whose work style was very different from yours.',
 'hr', 2, 1000, 'Conflict Resolution', 'Working Style Differences',
 '["adaptability", "teamwork", "communication", "empathy"]',
 'How did their style differ from yours specifically?',
 'What specific adjustments did you make to collaborate effectively?',
 'How did this experience influence how you approach future collaborations?'),

('Tell me about a time a team member was not meeting expectations. How did you handle it?',
 'hr', 3, 1100, 'Conflict Resolution', 'Underperformance',
 '["peer feedback", "accountability", "constructive criticism", "leadership"]',
 'What specifically were they not meeting expectations on?',
 'How did you approach the conversation — what did you say and how?',
 'What was the outcome and how did it affect team dynamics?'),

('Describe a time when you had to convince stakeholders who disagreed with your approach.',
 'hr', 3, 1100, 'Conflict Resolution', 'Stakeholder Alignment',
 '["persuasion", "data-driven arguments", "stakeholder management", "communication"]',
 'Who were the stakeholders and what was their concern?',
 'Walk me through how you built your case and how you presented it.',
 'What would you do differently next time to get buy-in earlier?'),

('Tell me about a disagreement you had with a technical decision on your team. What happened?',
 'hr', 2, 1000, 'Conflict Resolution', 'Technical Disagreements',
 '["technical debate", "reasoning", "team decision making", "professional disagreement"]',
 'What was the technical decision and why did you disagree?',
 'How did you voice your concern and what evidence did you use?',
 'Did the outcome prove your concern right or wrong?'),

-- Failure & Learning (5 questions)
('Tell me about a time you made a significant mistake at work. What happened and what did you learn?',
 'hr', 2, 1000, 'Failure & Learning', 'Mistakes',
 '["accountability", "learning from failure", "self-awareness", "STAR method"]',
 'What was the impact of the mistake on the project or team?',
 'Be specific about what YOU did wrong — not external factors.',
 'What concrete changes did you make to your process after this?'),

('Describe a project that failed. What went wrong and what would you do differently?',
 'hr', 2, 1000, 'Failure & Learning', 'Project Failure',
 '["failure analysis", "retrospective thinking", "accountability", "improvement"]',
 'What specifically caused the failure?',
 'What were the early warning signs you may have missed?',
 'How did you communicate the failure to stakeholders?'),

('Tell me about a time you received negative feedback. How did you react and what changed?',
 'hr', 1, 800, 'Failure & Learning', 'Feedback Reception',
 '["growth mindset", "feedback", "self-improvement", "resilience"]',
 'What was the feedback and how was it delivered?',
 'How did you feel initially, and how did that reaction evolve?',
 'What specific improvements did you make as a result?'),

('Have you ever started something and not completed it? What happened?',
 'hr', 2, 1000, 'Failure & Learning', 'Incomplete Work',
 '["honesty", "self-awareness", "accountability", "learning"]',
 'What was the reason you did not complete it?',
 'Was this the right call in hindsight or a mistake?',
 'What systems do you now have in place to avoid this?'),

-- Teamwork & Collaboration (5 questions)
('Tell me about a time you worked on a cross-functional team. What was your role and how did you contribute?',
 'hr', 1, 800, 'Teamwork & Collaboration', 'Cross-functional Work',
 '["collaboration", "communication across teams", "role clarity", "teamwork"]',
 'What functions were involved and what were the main challenges?',
 'What specifically did YOU contribute — not just what the team did?',
 'How did you navigate communication challenges across different teams?'),

('Describe a time when you helped a colleague who was struggling.',
 'hr', 1, 800, 'Teamwork & Collaboration', 'Helping Others',
 '["empathy", "mentoring", "teamwork", "knowledge sharing"]',
 'How did you notice they were struggling?',
 'What did you do to help — be specific about your actions.',
 'What was the long-term impact on the person and the team?'),

('Tell me about a time when the team''s goal changed mid-project. How did you adapt?',
 'hr', 2, 1000, 'Teamwork & Collaboration', 'Adaptability in Teams',
 '["adaptability", "change management", "flexibility", "team coordination"]',
 'What caused the change and how sudden was it?',
 'How did the team react and how did you help navigate it?',
 'What process improvements would have helped your team adapt faster?'),

('Give an example of a time when you supported a team decision even though you disagreed with it.',
 'hr', 2, 1000, 'Teamwork & Collaboration', 'Team Decision Buy-in',
 '["team player", "disagree and commit", "professionalism", "communication"]',
 'What was the decision you disagreed with?',
 'How did you express your concern and then align with the decision?',
 'Looking back, was the team right or were your concerns valid?'),

-- Initiative & Innovation (4 questions)
('Tell me about a time you suggested and implemented an improvement at work.',
 'hr', 2, 1000, 'Initiative & Innovation', 'Process Improvement',
 '["initiative", "innovation", "ownership", "impact measurement"]',
 'What problem were you solving with this improvement?',
 'Walk me through how you went from idea to implementation.',
 'How did you measure the impact of the improvement?'),

('Describe a time you went beyond your job description to deliver something valuable.',
 'hr', 2, 1000, 'Initiative & Innovation', 'Going Beyond',
 '["initiative", "ownership", "proactivity", "impact"]',
 'What prompted you to go beyond your role?',
 'What did you specifically do that was outside your responsibilities?',
 'How was this received by your team or manager?'),

('Tell me about a new skill you taught yourself to solve a problem at work.',
 'hr', 1, 800, 'Initiative & Innovation', 'Self-directed Learning',
 '["learning agility", "self-improvement", "problem solving", "technical growth"]',
 'What was the problem that required you to learn something new?',
 'How did you approach learning — what resources, how long, how did you validate it?',
 'How have you continued building on that skill since?'),

('Give an example of a creative solution you came up with for a difficult problem.',
 'hr', 2, 1000, 'Initiative & Innovation', 'Creative Problem Solving',
 '["creativity", "problem solving", "innovation", "STAR method"]',
 'What made the solution creative rather than obvious?',
 'What alternatives did you consider before settling on this approach?',
 'What was the impact of the creative solution vs a standard approach?'),

-- Time Management (4 questions)
('Tell me about a time you had to manage multiple competing priorities. How did you decide what to focus on?',
 'hr', 2, 1000, 'Time Management', 'Prioritization',
 '["prioritization", "time management", "decision making", "communication"]',
 'What were the competing priorities and who was affected by each?',
 'How did you decide what came first — walk me through your reasoning.',
 'How did you communicate trade-offs to stakeholders whose work was deprioritized?'),

('Describe a time when you failed to meet a deadline. What happened and what did you do?',
 'hr', 2, 1000, 'Time Management', 'Missed Deadlines',
 '["accountability", "time management", "communication", "learning from failure"]',
 'What caused you to miss the deadline?',
 'When did you know you would miss it and how did you communicate that?',
 'What changes did you make to prevent this from happening again?'),

('Tell me about a time you had to deliver quality work very quickly. How did you manage it?',
 'hr', 2, 1000, 'Time Management', 'Speed vs Quality',
 '["quality", "speed", "trade-offs", "prioritization"]',
 'What was the timeline and what did you have to cut to meet it?',
 'How did you ensure the quality was still acceptable despite the speed?',
 'What was the outcome and what feedback did you receive?'),

-- Adaptability (4 questions)
('Describe a time you had to learn a new technology or tool quickly for a project.',
 'hr', 1, 800, 'Adaptability', 'Learning New Tech',
 '["learning agility", "adaptability", "technical growth", "time pressure"]',
 'What was the technology and how quickly did you need to get up to speed?',
 'Walk me through how you learned it — what resources, what approach?',
 'How did your ramp-up affect the project timeline?'),

('Tell me about a time the requirements for a project changed significantly. How did you adapt?',
 'hr', 2, 1000, 'Adaptability', 'Changing Requirements',
 '["adaptability", "flexibility", "re-planning", "communication"]',
 'What changed and how late in the project did it happen?',
 'How did you communicate the impact of the change to your team and stakeholders?',
 'How has this experience changed how you scope and plan projects?'),

('Describe your biggest professional challenge in the past year and how you overcame it.',
 'hr', 2, 1000, 'Adaptability', 'Recent Challenge',
 '["self-awareness", "resilience", "growth mindset", "STAR method"]',
 'Why was this the biggest challenge — what made it particularly hard?',
 'What specific steps did you take to overcome it?',
 'What did this challenge teach you about yourself?'),

-- Communication (5 questions)
('Tell me about a time you had to explain a complex technical concept to a non-technical audience.',
 'hr', 2, 1000, 'Communication', 'Technical Communication',
 '["communication", "simplification", "audience awareness", "clarity"]',
 'Who was the audience and what was the concept?',
 'How did you simplify the explanation — what analogies or visuals did you use?',
 'How did you verify they understood — what was their reaction?'),

('Describe a time you had to deliver bad news to a stakeholder or your team.',
 'hr', 3, 1100, 'Communication', 'Delivering Bad News',
 '["honesty", "communication", "stakeholder management", "empathy"]',
 'What was the bad news and how did you prepare to deliver it?',
 'How did you frame the message — what did you say and how?',
 'What was the reaction and how did you handle it?'),

('Give an example of a time when your communication prevented a misunderstanding or conflict.',
 'hr', 2, 1000, 'Communication', 'Proactive Communication',
 '["proactive communication", "clarity", "conflict prevention", "team dynamics"]',
 'How did you identify the potential misunderstanding before it happened?',
 'What specific communication actions did you take?',
 'How do you now build this proactive communication into your workflow?'),

('Tell me about a time you had to present your work to leadership or senior stakeholders.',
 'hr', 2, 1000, 'Communication', 'Stakeholder Presentation',
 '["presentation skills", "executive communication", "data storytelling", "confidence"]',
 'What was the context and who was the audience?',
 'How did you prepare and structure the presentation?',
 'What feedback did you receive and how did it go?'),

('Describe a time when you had to write documentation or a report that others depended on.',
 'hr', 1, 800, 'Communication', 'Written Communication',
 '["written communication", "clarity", "documentation", "knowledge sharing"]',
 'Who was the audience for the documentation and what did they need from it?',
 'How did you structure and write it to make it clear and usable?',
 'How was it received — did people find it useful?');
