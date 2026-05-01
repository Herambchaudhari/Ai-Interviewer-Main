-- ── DSA problem bank ─────────────────────────────────────────────────────────
-- LeetCode-style array problems for the coding round MVP.
-- Run this once in Supabase SQL editor.

create table if not exists public.dsa_problems (
  id                          uuid primary key default gen_random_uuid(),
  slug                        text unique not null,
  title                       text not null,
  difficulty                  text not null check (difficulty in ('easy','medium','hard')),
  topics                      text[] not null default '{}',
  statement_md                text not null,
  constraints_md              text default '',
  examples                    jsonb not null default '[]'::jsonb,   -- [{input, output, explanation}]
  sample_tests                jsonb not null default '[]'::jsonb,   -- [{input, expected}]
  hidden_tests                jsonb not null default '[]'::jsonb,   -- [{input, expected, kind?}]
  function_signature          jsonb not null default '{}'::jsonb,   -- {name, params:[{name,type}], returns}
  starter_code                jsonb not null default '{}'::jsonb,   -- {python, javascript, cpp, java}
  driver_code                 jsonb not null default '{}'::jsonb,   -- {python, javascript, cpp, java}
  reference_complexity_time   text default '',
  reference_complexity_space  text default '',
  time_limit_ms               int default 2000,
  memory_limit_mb             int default 256,
  created_at                  timestamptz default now()
);

create index if not exists dsa_problems_difficulty_idx on public.dsa_problems(difficulty);
create index if not exists dsa_problems_topics_idx     on public.dsa_problems using gin(topics);

-- ── Seed: 12 array problems (1D & 2D) — easy/medium ─────────────────────────
-- All driver code reads JSON from stdin, calls user solution, prints JSON to stdout.
-- The literal token __USER_CODE__ is replaced by the user's submission at runtime.

insert into public.dsa_problems
  (slug, title, difficulty, topics, statement_md, constraints_md, examples,
   sample_tests, hidden_tests, function_signature, starter_code, driver_code,
   reference_complexity_time, reference_complexity_space)
values

-- 1. Two Sum
('two-sum', 'Two Sum', 'easy', ARRAY['array','hash-table'],
$md$Given an array of integers `nums` and an integer `target`, return **indices** of the two numbers that add up to `target`. You may assume exactly one solution exists, and you may not use the same element twice. Return the answer in any order.$md$,
$md$- 2 ≤ nums.length ≤ 10⁴
- −10⁹ ≤ nums[i] ≤ 10⁹
- −10⁹ ≤ target ≤ 10⁹$md$,
'[{"input":"nums = [2,7,11,15], target = 9","output":"[0,1]","explanation":"nums[0]+nums[1] = 9"},{"input":"nums = [3,2,4], target = 6","output":"[1,2]"}]'::jsonb,
'[{"input":{"nums":[2,7,11,15],"target":9},"expected":[0,1]},{"input":{"nums":[3,2,4],"target":6},"expected":[1,2]}]'::jsonb,
'[{"input":{"nums":[3,3],"target":6},"expected":[0,1]},{"input":{"nums":[-1,-2,-3,-4,-5],"target":-8},"expected":[2,4]},{"input":{"nums":[1,5,3,7,9,2],"target":11},"expected":[1,3]},{"input":{"nums":[0,4,3,0],"target":0},"expected":[0,3]},{"input":{"nums":[-3,4,3,90],"target":0},"expected":[0,2]},{"input":{"nums":[1000000000,2,7,-1000000000],"target":9},"expected":[1,2]}]'::jsonb,
'{"name":"twoSum","params":[{"name":"nums","type":"int[]"},{"name":"target","type":"int"}],"returns":"int[]"}'::jsonb,
'{"python":"class Solution:\n    def twoSum(self, nums, target):\n        # Write your solution here\n        pass\n","javascript":"var twoSum = function(nums, target) {\n    // Write your solution here\n};\n","cpp":"class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        // Write your solution here\n    }\n};\n","java":"class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // Write your solution here\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\ndata=json.loads(sys.stdin.read())\nprint(json.dumps(sorted(Solution().twoSum(data[\"nums\"],data[\"target\"]))))\n","javascript":"__USER_CODE__\nlet data=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));\nconsole.log(JSON.stringify(twoSum(data.nums,data.target).slice().sort((a,b)=>a-b)));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> nums=d[\"nums\"];int target=d[\"target\"];auto r=Solution().twoSum(nums,target);sort(r.begin(),r.end());cout<<json(r).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] nums=new int[n.size()];for(int i=0;i<n.size();i++)nums[i]=n.get(i).getAsInt();int t=d.get(\"target\").getAsInt();int[] r=new Solution().twoSum(nums,t);Arrays.sort(r);System.out.print(new Gson().toJson(r));}}\n"}'::jsonb,
'O(n)','O(n)'),

-- 2. Best Time to Buy and Sell Stock
('best-time-to-buy-and-sell-stock', 'Best Time to Buy and Sell Stock', 'easy', ARRAY['array','dp'],
$md$You are given an array `prices` where `prices[i]` is the price of a given stock on the iᵗʰ day. You want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock. Return the **maximum profit** you can achieve from this transaction. If you cannot achieve any profit, return `0`.$md$,
$md$- 1 ≤ prices.length ≤ 10⁵
- 0 ≤ prices[i] ≤ 10⁴$md$,
'[{"input":"prices = [7,1,5,3,6,4]","output":"5","explanation":"Buy on day 2 (price=1) and sell on day 5 (price=6), profit = 6−1 = 5."},{"input":"prices = [7,6,4,3,1]","output":"0","explanation":"No transaction is done."}]'::jsonb,
'[{"input":{"prices":[7,1,5,3,6,4]},"expected":5},{"input":{"prices":[7,6,4,3,1]},"expected":0}]'::jsonb,
'[{"input":{"prices":[1]},"expected":0},{"input":{"prices":[2,4,1]},"expected":2},{"input":{"prices":[1,2,3,4,5]},"expected":4},{"input":{"prices":[3,2,6,5,0,3]},"expected":4},{"input":{"prices":[10000,1,10000]},"expected":9999},{"input":{"prices":[2,1,2,1,0,1,2]},"expected":2}]'::jsonb,
'{"name":"maxProfit","params":[{"name":"prices","type":"int[]"}],"returns":"int"}'::jsonb,
'{"python":"class Solution:\n    def maxProfit(self, prices):\n        pass\n","javascript":"var maxProfit = function(prices) {\n};\n","cpp":"class Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n    }\n};\n","java":"class Solution {\n    public int maxProfit(int[] prices) {\n        return 0;\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(Solution().maxProfit(d[\"prices\"]))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(maxProfit(d.prices));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> p=d[\"prices\"];cout<<Solution().maxProfit(p);return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"prices\");int[] p=new int[n.size()];for(int i=0;i<n.size();i++)p[i]=n.get(i).getAsInt();System.out.print(new Solution().maxProfit(p));}}\n"}'::jsonb,
'O(n)','O(1)'),

-- 3. Contains Duplicate
('contains-duplicate', 'Contains Duplicate', 'easy', ARRAY['array','hash-table'],
$md$Given an integer array `nums`, return `true` if any value appears **at least twice** in the array, and return `false` if every element is distinct.$md$,
$md$- 1 ≤ nums.length ≤ 10⁵
- −10⁹ ≤ nums[i] ≤ 10⁹$md$,
'[{"input":"nums = [1,2,3,1]","output":"true"},{"input":"nums = [1,2,3,4]","output":"false"}]'::jsonb,
'[{"input":{"nums":[1,2,3,1]},"expected":true},{"input":{"nums":[1,2,3,4]},"expected":false}]'::jsonb,
'[{"input":{"nums":[1]},"expected":false},{"input":{"nums":[1,1,1,3,3,4,3,2,4,2]},"expected":true},{"input":{"nums":[-1,-1]},"expected":true},{"input":{"nums":[0]},"expected":false},{"input":{"nums":[1000000000,-1000000000,1000000000]},"expected":true}]'::jsonb,
'{"name":"containsDuplicate","params":[{"name":"nums","type":"int[]"}],"returns":"bool"}'::jsonb,
'{"python":"class Solution:\n    def containsDuplicate(self, nums):\n        pass\n","javascript":"var containsDuplicate = function(nums) {\n};\n","cpp":"class Solution {\npublic:\n    bool containsDuplicate(vector<int>& nums) {\n    }\n};\n","java":"class Solution {\n    public boolean containsDuplicate(int[] nums) {\n        return false;\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(\"true\" if Solution().containsDuplicate(d[\"nums\"]) else \"false\")\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(containsDuplicate(d.nums)?\"true\":\"false\");\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> n=d[\"nums\"];cout<<(Solution().containsDuplicate(n)?\"true\":\"false\");return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] x=new int[n.size()];for(int i=0;i<n.size();i++)x[i]=n.get(i).getAsInt();System.out.print(new Solution().containsDuplicate(x)?\"true\":\"false\");}}\n"}'::jsonb,
'O(n)','O(n)'),

-- 4. Maximum Subarray
('maximum-subarray', 'Maximum Subarray', 'medium', ARRAY['array','dp','divide-and-conquer'],
$md$Given an integer array `nums`, find the **contiguous subarray** (containing at least one number) which has the largest sum and return its sum.$md$,
$md$- 1 ≤ nums.length ≤ 10⁵
- −10⁴ ≤ nums[i] ≤ 10⁴$md$,
'[{"input":"nums = [-2,1,-3,4,-1,2,1,-5,4]","output":"6","explanation":"[4,-1,2,1] has the largest sum = 6."},{"input":"nums = [1]","output":"1"},{"input":"nums = [5,4,-1,7,8]","output":"23"}]'::jsonb,
'[{"input":{"nums":[-2,1,-3,4,-1,2,1,-5,4]},"expected":6},{"input":{"nums":[1]},"expected":1},{"input":{"nums":[5,4,-1,7,8]},"expected":23}]'::jsonb,
'[{"input":{"nums":[-1]},"expected":-1},{"input":{"nums":[-2,-1]},"expected":-1},{"input":{"nums":[-2,-3,-1,-5]},"expected":-1},{"input":{"nums":[1,2,3,4,5]},"expected":15},{"input":{"nums":[8,-19,5,-4,20]},"expected":21},{"input":{"nums":[10000,-10000,10000,-10000,10000]},"expected":10000}]'::jsonb,
'{"name":"maxSubArray","params":[{"name":"nums","type":"int[]"}],"returns":"int"}'::jsonb,
'{"python":"class Solution:\n    def maxSubArray(self, nums):\n        pass\n","javascript":"var maxSubArray = function(nums) {\n};\n","cpp":"class Solution {\npublic:\n    int maxSubArray(vector<int>& nums) {\n    }\n};\n","java":"class Solution {\n    public int maxSubArray(int[] nums) {\n        return 0;\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(Solution().maxSubArray(d[\"nums\"]))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(maxSubArray(d.nums));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> n=d[\"nums\"];cout<<Solution().maxSubArray(n);return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] x=new int[n.size()];for(int i=0;i<n.size();i++)x[i]=n.get(i).getAsInt();System.out.print(new Solution().maxSubArray(x));}}\n"}'::jsonb,
'O(n)','O(1)'),

-- 5. Move Zeroes
('move-zeroes', 'Move Zeroes', 'easy', ARRAY['array','two-pointers'],
$md$Given an integer array `nums`, move all `0`s to the end of it while maintaining the relative order of the non-zero elements. You must do this **in-place** without making a copy of the array. Return the resulting array.$md$,
$md$- 1 ≤ nums.length ≤ 10⁴
- −2³¹ ≤ nums[i] ≤ 2³¹ − 1$md$,
'[{"input":"nums = [0,1,0,3,12]","output":"[1,3,12,0,0]"},{"input":"nums = [0]","output":"[0]"}]'::jsonb,
'[{"input":{"nums":[0,1,0,3,12]},"expected":[1,3,12,0,0]},{"input":{"nums":[0]},"expected":[0]}]'::jsonb,
'[{"input":{"nums":[1,2,3]},"expected":[1,2,3]},{"input":{"nums":[0,0,0,1]},"expected":[1,0,0,0]},{"input":{"nums":[1,0,2,0,3,0]},"expected":[1,2,3,0,0,0]},{"input":{"nums":[-1,0,-2,0,3]},"expected":[-1,-2,3,0,0]},{"input":{"nums":[0,0,0,0]},"expected":[0,0,0,0]}]'::jsonb,
'{"name":"moveZeroes","params":[{"name":"nums","type":"int[]"}],"returns":"int[]"}'::jsonb,
'{"python":"class Solution:\n    def moveZeroes(self, nums):\n        # modify nums in-place; return is optional\n        pass\n","javascript":"var moveZeroes = function(nums) {\n    // modify nums in-place\n};\n","cpp":"class Solution {\npublic:\n    void moveZeroes(vector<int>& nums) {\n    }\n};\n","java":"class Solution {\n    public void moveZeroes(int[] nums) {\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nnums=d[\"nums\"]\nSolution().moveZeroes(nums)\nprint(json.dumps(nums))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));moveZeroes(d.nums);console.log(JSON.stringify(d.nums));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> n=d[\"nums\"];Solution().moveZeroes(n);cout<<json(n).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] x=new int[n.size()];for(int i=0;i<n.size();i++)x[i]=n.get(i).getAsInt();new Solution().moveZeroes(x);System.out.print(new Gson().toJson(x));}}\n"}'::jsonb,
'O(n)','O(1)'),

-- 6. Product of Array Except Self
('product-of-array-except-self', 'Product of Array Except Self', 'medium', ARRAY['array','prefix-sum'],
$md$Given an integer array `nums`, return an array `answer` such that `answer[i]` is equal to the product of all the elements of `nums` except `nums[i]`. The product of any prefix or suffix of `nums` is **guaranteed** to fit in a 32-bit integer. You must write an algorithm that runs in **O(n)** time and **without** using the division operation.$md$,
$md$- 2 ≤ nums.length ≤ 10⁵
- −30 ≤ nums[i] ≤ 30$md$,
'[{"input":"nums = [1,2,3,4]","output":"[24,12,8,6]"},{"input":"nums = [-1,1,0,-3,3]","output":"[0,0,9,0,0]"}]'::jsonb,
'[{"input":{"nums":[1,2,3,4]},"expected":[24,12,8,6]},{"input":{"nums":[-1,1,0,-3,3]},"expected":[0,0,9,0,0]}]'::jsonb,
'[{"input":{"nums":[2,3]},"expected":[3,2]},{"input":{"nums":[1,1,1,1]},"expected":[1,1,1,1]},{"input":{"nums":[0,0]},"expected":[0,0]},{"input":{"nums":[5,2,1,3]},"expected":[6,15,30,10]},{"input":{"nums":[-1,-1,-1]},"expected":[1,1,1]}]'::jsonb,
'{"name":"productExceptSelf","params":[{"name":"nums","type":"int[]"}],"returns":"int[]"}'::jsonb,
'{"python":"class Solution:\n    def productExceptSelf(self, nums):\n        pass\n","javascript":"var productExceptSelf = function(nums) {\n};\n","cpp":"class Solution {\npublic:\n    vector<int> productExceptSelf(vector<int>& nums) {\n    }\n};\n","java":"class Solution {\n    public int[] productExceptSelf(int[] nums) {\n        return new int[0];\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(json.dumps(Solution().productExceptSelf(d[\"nums\"])))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(JSON.stringify(productExceptSelf(d.nums)));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> n=d[\"nums\"];auto r=Solution().productExceptSelf(n);cout<<json(r).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] x=new int[n.size()];for(int i=0;i<n.size();i++)x[i]=n.get(i).getAsInt();int[] r=new Solution().productExceptSelf(x);System.out.print(new Gson().toJson(r));}}\n"}'::jsonb,
'O(n)','O(1) extra'),

-- 7. Find the Duplicate Number
('find-the-duplicate-number', 'Find the Duplicate Number', 'medium', ARRAY['array','two-pointers','binary-search'],
$md$Given an array of integers `nums` containing `n + 1` integers where each integer is in the range `[1, n]` inclusive, there is only **one repeated number** in `nums`. Return this repeated number. You must solve the problem **without modifying** the array `nums` and using only constant extra space.$md$,
$md$- 1 ≤ n ≤ 10⁵
- nums.length == n + 1
- 1 ≤ nums[i] ≤ n$md$,
'[{"input":"nums = [1,3,4,2,2]","output":"2"},{"input":"nums = [3,1,3,4,2]","output":"3"}]'::jsonb,
'[{"input":{"nums":[1,3,4,2,2]},"expected":2},{"input":{"nums":[3,1,3,4,2]},"expected":3}]'::jsonb,
'[{"input":{"nums":[1,1]},"expected":1},{"input":{"nums":[2,2,2,2,2]},"expected":2},{"input":{"nums":[1,4,4,2,4,3,4]},"expected":4},{"input":{"nums":[3,3,3,3,3,3,3,3,3,3]},"expected":3},{"input":{"nums":[1,2,3,4,5,6,7,8,9,5]},"expected":5}]'::jsonb,
'{"name":"findDuplicate","params":[{"name":"nums","type":"int[]"}],"returns":"int"}'::jsonb,
'{"python":"class Solution:\n    def findDuplicate(self, nums):\n        pass\n","javascript":"var findDuplicate = function(nums) {\n};\n","cpp":"class Solution {\npublic:\n    int findDuplicate(vector<int>& nums) {\n    }\n};\n","java":"class Solution {\n    public int findDuplicate(int[] nums) {\n        return 0;\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(Solution().findDuplicate(d[\"nums\"]))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(findDuplicate(d.nums));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> n=d[\"nums\"];cout<<Solution().findDuplicate(n);return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] x=new int[n.size()];for(int i=0;i<n.size();i++)x[i]=n.get(i).getAsInt();System.out.print(new Solution().findDuplicate(x));}}\n"}'::jsonb,
'O(n)','O(1)'),

-- 8. Rotate Array
('rotate-array', 'Rotate Array', 'medium', ARRAY['array','two-pointers'],
$md$Given an integer array `nums`, rotate the array to the right by `k` steps, where `k` is non-negative. Modify the array in-place and return it.$md$,
$md$- 1 ≤ nums.length ≤ 10⁵
- −2³¹ ≤ nums[i] ≤ 2³¹ − 1
- 0 ≤ k ≤ 10⁵$md$,
'[{"input":"nums = [1,2,3,4,5,6,7], k = 3","output":"[5,6,7,1,2,3,4]"},{"input":"nums = [-1,-100,3,99], k = 2","output":"[3,99,-1,-100]"}]'::jsonb,
'[{"input":{"nums":[1,2,3,4,5,6,7],"k":3},"expected":[5,6,7,1,2,3,4]},{"input":{"nums":[-1,-100,3,99],"k":2},"expected":[3,99,-1,-100]}]'::jsonb,
'[{"input":{"nums":[1],"k":0},"expected":[1]},{"input":{"nums":[1,2],"k":3},"expected":[2,1]},{"input":{"nums":[1,2,3],"k":4},"expected":[3,1,2]},{"input":{"nums":[1,2,3,4,5],"k":0},"expected":[1,2,3,4,5]},{"input":{"nums":[1,2,3,4,5,6],"k":11},"expected":[2,3,4,5,6,1]}]'::jsonb,
'{"name":"rotate","params":[{"name":"nums","type":"int[]"},{"name":"k","type":"int"}],"returns":"int[]"}'::jsonb,
'{"python":"class Solution:\n    def rotate(self, nums, k):\n        pass\n","javascript":"var rotate = function(nums, k) {\n};\n","cpp":"class Solution {\npublic:\n    void rotate(vector<int>& nums, int k) {\n    }\n};\n","java":"class Solution {\n    public void rotate(int[] nums, int k) {\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nnums=d[\"nums\"]\nSolution().rotate(nums,d[\"k\"])\nprint(json.dumps(nums))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));rotate(d.nums,d.k);console.log(JSON.stringify(d.nums));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<int> n=d[\"nums\"];int k=d[\"k\"];Solution().rotate(n,k);cout<<json(n).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray n=d.getAsJsonArray(\"nums\");int[] x=new int[n.size()];for(int i=0;i<n.size();i++)x[i]=n.get(i).getAsInt();int k=d.get(\"k\").getAsInt();new Solution().rotate(x,k);System.out.print(new Gson().toJson(x));}}\n"}'::jsonb,
'O(n)','O(1)'),

-- 9. Spiral Matrix (2D)
('spiral-matrix', 'Spiral Matrix', 'medium', ARRAY['array','matrix','simulation'],
$md$Given an m x n `matrix`, return all elements of the matrix in **spiral order** (clockwise, starting from the top-left).$md$,
$md$- m == matrix.length
- n == matrix[i].length
- 1 ≤ m, n ≤ 10
- −100 ≤ matrix[i][j] ≤ 100$md$,
'[{"input":"matrix = [[1,2,3],[4,5,6],[7,8,9]]","output":"[1,2,3,6,9,8,7,4,5]"},{"input":"matrix = [[1,2,3,4],[5,6,7,8],[9,10,11,12]]","output":"[1,2,3,4,8,12,11,10,9,5,6,7]"}]'::jsonb,
'[{"input":{"matrix":[[1,2,3],[4,5,6],[7,8,9]]},"expected":[1,2,3,6,9,8,7,4,5]},{"input":{"matrix":[[1,2,3,4],[5,6,7,8],[9,10,11,12]]},"expected":[1,2,3,4,8,12,11,10,9,5,6,7]}]'::jsonb,
'[{"input":{"matrix":[[1]]},"expected":[1]},{"input":{"matrix":[[1,2],[3,4]]},"expected":[1,2,4,3]},{"input":{"matrix":[[1],[2],[3]]},"expected":[1,2,3]},{"input":{"matrix":[[1,2,3]]},"expected":[1,2,3]},{"input":{"matrix":[[1,2,3],[4,5,6],[7,8,9],[10,11,12]]},"expected":[1,2,3,6,9,12,11,10,7,4,5,8]}]'::jsonb,
'{"name":"spiralOrder","params":[{"name":"matrix","type":"int[][]"}],"returns":"int[]"}'::jsonb,
'{"python":"class Solution:\n    def spiralOrder(self, matrix):\n        pass\n","javascript":"var spiralOrder = function(matrix) {\n};\n","cpp":"class Solution {\npublic:\n    vector<int> spiralOrder(vector<vector<int>>& matrix) {\n    }\n};\n","java":"class Solution {\n    public List<Integer> spiralOrder(int[][] matrix) {\n        return new ArrayList<>();\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(json.dumps(Solution().spiralOrder(d[\"matrix\"])))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(JSON.stringify(spiralOrder(d.matrix)));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<vector<int>> m=d[\"matrix\"];auto r=Solution().spiralOrder(m);cout<<json(r).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray rows=d.getAsJsonArray(\"matrix\");int[][] mat=new int[rows.size()][];for(int i=0;i<rows.size();i++){JsonArray r=rows.get(i).getAsJsonArray();mat[i]=new int[r.size()];for(int j=0;j<r.size();j++)mat[i][j]=r.get(j).getAsInt();}List<Integer> res=new Solution().spiralOrder(mat);System.out.print(new Gson().toJson(res));}}\n"}'::jsonb,
'O(m·n)','O(1) extra'),

-- 10. Rotate Image (2D in-place)
('rotate-image', 'Rotate Image', 'medium', ARRAY['array','matrix'],
$md$You are given an n x n 2D `matrix` representing an image. Rotate the image by **90 degrees clockwise**. You have to rotate the image **in-place**, which means you have to modify the input 2D matrix directly. **Do not** allocate another 2D matrix and do the rotation. Return the rotated matrix.$md$,
$md$- n == matrix.length == matrix[i].length
- 1 ≤ n ≤ 20
- −1000 ≤ matrix[i][j] ≤ 1000$md$,
'[{"input":"matrix = [[1,2,3],[4,5,6],[7,8,9]]","output":"[[7,4,1],[8,5,2],[9,6,3]]"},{"input":"matrix = [[5,1,9,11],[2,4,8,10],[13,3,6,7],[15,14,12,16]]","output":"[[15,13,2,5],[14,3,4,1],[12,6,8,9],[16,7,10,11]]"}]'::jsonb,
'[{"input":{"matrix":[[1,2,3],[4,5,6],[7,8,9]]},"expected":[[7,4,1],[8,5,2],[9,6,3]]},{"input":{"matrix":[[5,1,9,11],[2,4,8,10],[13,3,6,7],[15,14,12,16]]},"expected":[[15,13,2,5],[14,3,4,1],[12,6,8,9],[16,7,10,11]]}]'::jsonb,
'[{"input":{"matrix":[[1]]},"expected":[[1]]},{"input":{"matrix":[[1,2],[3,4]]},"expected":[[3,1],[4,2]]},{"input":{"matrix":[[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,24,25]]},"expected":[[21,16,11,6,1],[22,17,12,7,2],[23,18,13,8,3],[24,19,14,9,4],[25,20,15,10,5]]}]'::jsonb,
'{"name":"rotate","params":[{"name":"matrix","type":"int[][]"}],"returns":"int[][]"}'::jsonb,
'{"python":"class Solution:\n    def rotate(self, matrix):\n        pass\n","javascript":"var rotate = function(matrix) {\n};\n","cpp":"class Solution {\npublic:\n    void rotate(vector<vector<int>>& matrix) {\n    }\n};\n","java":"class Solution {\n    public void rotate(int[][] matrix) {\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nm=d[\"matrix\"]\nSolution().rotate(m)\nprint(json.dumps(m))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));rotate(d.matrix);console.log(JSON.stringify(d.matrix));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<vector<int>> m=d[\"matrix\"];Solution().rotate(m);cout<<json(m).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray rows=d.getAsJsonArray(\"matrix\");int n=rows.size();int[][] mat=new int[n][n];for(int i=0;i<n;i++){JsonArray r=rows.get(i).getAsJsonArray();for(int j=0;j<n;j++)mat[i][j]=r.get(j).getAsInt();}new Solution().rotate(mat);System.out.print(new Gson().toJson(mat));}}\n"}'::jsonb,
'O(n²)','O(1)'),

-- 11. Set Matrix Zeroes (2D)
('set-matrix-zeroes', 'Set Matrix Zeroes', 'medium', ARRAY['array','matrix','hash-table'],
$md$Given an m x n integer matrix, if an element is `0`, set its **entire row and column** to `0`'s. You must do it **in-place**.$md$,
$md$- m == matrix.length
- n == matrix[0].length
- 1 ≤ m, n ≤ 200
- −2³¹ ≤ matrix[i][j] ≤ 2³¹ − 1$md$,
'[{"input":"matrix = [[1,1,1],[1,0,1],[1,1,1]]","output":"[[1,0,1],[0,0,0],[1,0,1]]"},{"input":"matrix = [[0,1,2,0],[3,4,5,2],[1,3,1,5]]","output":"[[0,0,0,0],[0,4,5,0],[0,3,1,0]]"}]'::jsonb,
'[{"input":{"matrix":[[1,1,1],[1,0,1],[1,1,1]]},"expected":[[1,0,1],[0,0,0],[1,0,1]]},{"input":{"matrix":[[0,1,2,0],[3,4,5,2],[1,3,1,5]]},"expected":[[0,0,0,0],[0,4,5,0],[0,3,1,0]]}]'::jsonb,
'[{"input":{"matrix":[[1]]},"expected":[[1]]},{"input":{"matrix":[[0]]},"expected":[[0]]},{"input":{"matrix":[[1,2],[3,4]]},"expected":[[1,2],[3,4]]},{"input":{"matrix":[[1,0],[3,4]]},"expected":[[0,0],[3,0]]},{"input":{"matrix":[[1,2,3],[4,0,6],[7,8,9]]},"expected":[[1,0,3],[0,0,0],[7,0,9]]}]'::jsonb,
'{"name":"setZeroes","params":[{"name":"matrix","type":"int[][]"}],"returns":"int[][]"}'::jsonb,
'{"python":"class Solution:\n    def setZeroes(self, matrix):\n        pass\n","javascript":"var setZeroes = function(matrix) {\n};\n","cpp":"class Solution {\npublic:\n    void setZeroes(vector<vector<int>>& matrix) {\n    }\n};\n","java":"class Solution {\n    public void setZeroes(int[][] matrix) {\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nm=d[\"matrix\"]\nSolution().setZeroes(m)\nprint(json.dumps(m))\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));setZeroes(d.matrix);console.log(JSON.stringify(d.matrix));\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<vector<int>> m=d[\"matrix\"];Solution().setZeroes(m);cout<<json(m).dump();return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray rows=d.getAsJsonArray(\"matrix\");int m=rows.size();int n=rows.get(0).getAsJsonArray().size();int[][] mat=new int[m][n];for(int i=0;i<m;i++){JsonArray r=rows.get(i).getAsJsonArray();for(int j=0;j<n;j++)mat[i][j]=r.get(j).getAsInt();}new Solution().setZeroes(mat);System.out.print(new Gson().toJson(mat));}}\n"}'::jsonb,
'O(m·n)','O(1) extra'),

-- 12. Search a 2D Matrix
('search-a-2d-matrix', 'Search a 2D Matrix', 'medium', ARRAY['array','matrix','binary-search'],
$md$You are given an m x n integer `matrix` with the following two properties:
- Each row is sorted in non-decreasing order.
- The first integer of each row is greater than the last integer of the previous row.

Given an integer `target`, return `true` if `target` is in `matrix` or `false` otherwise. You must write a solution in `O(log(m·n))` time complexity.$md$,
$md$- m == matrix.length
- n == matrix[i].length
- 1 ≤ m, n ≤ 100
- −10⁴ ≤ matrix[i][j], target ≤ 10⁴$md$,
'[{"input":"matrix = [[1,3,5,7],[10,11,16,20],[23,30,34,60]], target = 3","output":"true"},{"input":"matrix = [[1,3,5,7],[10,11,16,20],[23,30,34,60]], target = 13","output":"false"}]'::jsonb,
'[{"input":{"matrix":[[1,3,5,7],[10,11,16,20],[23,30,34,60]],"target":3},"expected":true},{"input":{"matrix":[[1,3,5,7],[10,11,16,20],[23,30,34,60]],"target":13},"expected":false}]'::jsonb,
'[{"input":{"matrix":[[1]],"target":1},"expected":true},{"input":{"matrix":[[1]],"target":2},"expected":false},{"input":{"matrix":[[1,3]],"target":3},"expected":true},{"input":{"matrix":[[1],[3]],"target":3},"expected":true},{"input":{"matrix":[[1,2,3,4,5],[6,7,8,9,10]],"target":7},"expected":true},{"input":{"matrix":[[-10,-5,0,5,10]],"target":-7},"expected":false}]'::jsonb,
'{"name":"searchMatrix","params":[{"name":"matrix","type":"int[][]"},{"name":"target","type":"int"}],"returns":"bool"}'::jsonb,
'{"python":"class Solution:\n    def searchMatrix(self, matrix, target):\n        pass\n","javascript":"var searchMatrix = function(matrix, target) {\n};\n","cpp":"class Solution {\npublic:\n    bool searchMatrix(vector<vector<int>>& matrix, int target) {\n    }\n};\n","java":"class Solution {\n    public boolean searchMatrix(int[][] matrix, int target) {\n        return false;\n    }\n}\n"}'::jsonb,
'{"python":"import json,sys\n__USER_CODE__\nd=json.loads(sys.stdin.read())\nprint(\"true\" if Solution().searchMatrix(d[\"matrix\"],d[\"target\"]) else \"false\")\n","javascript":"__USER_CODE__\nlet d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(searchMatrix(d.matrix,d.target)?\"true\":\"false\");\n","cpp":"#include<bits/stdc++.h>\nusing namespace std;\n#include<nlohmann/json.hpp>\nusing json=nlohmann::json;\n__USER_CODE__\nint main(){json d;cin>>d;vector<vector<int>> m=d[\"matrix\"];int t=d[\"target\"];cout<<(Solution().searchMatrix(m,t)?\"true\":\"false\");return 0;}\n","java":"import com.google.gson.*;import java.util.*;import java.io.*;\n__USER_CODE__\npublic class Main{public static void main(String[]a)throws Exception{String s=new BufferedReader(new InputStreamReader(System.in)).lines().reduce(\"\",(x,y)->x+y);JsonObject d=JsonParser.parseString(s).getAsJsonObject();JsonArray rows=d.getAsJsonArray(\"matrix\");int m=rows.size();int n=rows.get(0).getAsJsonArray().size();int[][] mat=new int[m][n];for(int i=0;i<m;i++){JsonArray r=rows.get(i).getAsJsonArray();for(int j=0;j<n;j++)mat[i][j]=r.get(j).getAsInt();}int t=d.get(\"target\").getAsInt();System.out.print(new Solution().searchMatrix(mat,t)?\"true\":\"false\");}}\n"}'::jsonb,
'O(log(m·n))','O(1)')

on conflict (slug) do nothing;
