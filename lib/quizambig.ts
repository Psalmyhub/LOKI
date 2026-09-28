import { createClient } from "genlayer-js";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";
import { studionet } from "genlayer-js/chains";

export const QUIZAMBIG_CONTRACT_ADDRESS = "0x8B40151A03c27C5B0De2f8DB01c17a5cd36FB658" as const;
export const QUIZAMBIG_OWNER = "0xB41f7CcF919515a4741C7AAd43cFfCd56A20Ee31" as const;

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
declare global { interface Window { ethereum?: EthereumProvider } }

export type Quiz = {
  id:number; master:string; title:string; question_count:number; created_at:number;
  published_at:number; start_at:number; expires_at:number; access_commitment:string; status:string;
};
export type Question = {
  id:number; quiz_id:string; index:number; question_text:string; answer_length:number;
  answer_mode:"TEXT"|"NUMERIC"; duration:number; final_time:number; start_time:number; deadline:number; status:string;
};
export type Evaluation = {
  question_id:number; player:string; status:string; semantic_score:number; correct:boolean;
  response_time_seconds:number; submitted_at:number;
};

const readClient=()=>createClient({chain:studionet});
async function walletAddress():Promise<`0x${string}`>{
  if(!window.ethereum) throw new Error("No browser wallet detected.");
  const accounts=await window.ethereum.request({method:"eth_requestAccounts"});
  const address=Array.isArray(accounts)?accounts[0]:undefined;
  if(typeof address!=="string") throw new Error("No wallet account returned.");
  return address as `0x${string}`;
}
function writeClient(account:`0x${string}`){
  if(!window.ethereum) throw new Error("No browser wallet detected.");
  return createClient({chain:studionet,account,provider:window.ethereum});
}
export const connectWallet=walletAddress;
async function sha256Hex(value:string):Promise<string>{
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function createQuiz(title:string,questionCount:number){return write("create_quiz",[title,questionCount]);}
export async function addQuestion(quizId:number,questionText:string,masterAnswer:string,salt:string,answerMode:"TEXT"|"NUMERIC",durationSeconds:number){
  const commitment=await sha256Hex(`${masterAnswer}:${salt}:${answerMode}`);
  return write("add_question",[quizId,questionText,commitment,masterAnswer.length,answerMode,durationSeconds]);
}
export async function publishQuiz(quizId:number,startTime:number,accessCommitment:string){return write("publish_quiz",[quizId,startTime,accessCommitment]);}
export async function hashAccessToken(token:string){return sha256Hex(token);}
export function generateAccessToken(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");}
export function generateSalt(){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");}
export async function getNextQuestionId(){return Number(await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_next_question_id",args:[]}));}
export async function getNextQuizId(){return Number(await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_next_quiz_id",args:[]}));}
export async function getQuiz(id:number):Promise<Quiz>{return await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_quiz",args:[id],jsonSafeReturn:true}) as Quiz;}
export async function getCurrentQuestion(id:number):Promise<Question>{return await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_current_question",args:[id],jsonSafeReturn:true}) as Question;}
export async function getQuestion(id:number):Promise<Question>{return await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_question",args:[id],jsonSafeReturn:true}) as Question;}
export async function getQuestionId(quizId:number,index:number){return Number(await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_question_id",args:[quizId,index]}));}
export async function getPlayerStatus(id:number,player:`0x${string}`){return await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_player_status",args:[id,player],jsonSafeReturn:true}) as {joined:boolean;quiz_id:number;player:string};}
export async function getPlayerCount(id:number){return Number(await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_player_count",args:[id]}));}
export async function getPlayer(id:number,index:number){return String(await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_player",args:[id,index]}));}
export async function getEvaluation(questionId:number,player:`0x${string}`){return await readClient().readContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName:"get_evaluation",args:[questionId,player],jsonSafeReturn:true}) as Evaluation;}
export async function evaluateSubmission(questionId:number,player:`0x${string}`,masterAnswer:string,salt:string){return write("evaluate_submission",[questionId,player,masterAnswer,salt]);}
async function write(functionName:string,args:any[]){
  const account=await walletAddress(); const client=writeClient(account);
  const hash=await client.writeContract({address:QUIZAMBIG_CONTRACT_ADDRESS,functionName,args,value:0n});
  const receipt=await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
  });
  if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(
      `GenLayer contract execution failed: ${receipt.txExecutionResultName ?? "unknown execution result"}`,
    );
  }
  return hash;
}
export const joinQuiz=(id:number)=>write("join_quiz",[id]);
export const submitAnswer=(questionId:number,answer:string)=>write("submit_answer",[questionId,answer]);
