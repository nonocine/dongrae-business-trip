import { CONTRACT_ORG, circled, type ContractBlock } from "@/lib/employmentContracts";

// =====================================================================
// 근로계약서 본문 — 화면용. PDF(lib/employmentContractPdf)와 같은 블록 배열을
//   그립니다(문장 조립은 lib/employmentContracts.buildContractBlocks 한 곳).
//   프레젠테이션 전용 — 서버·클라이언트 어디서든 렌더 가능.
// =====================================================================

export default function ContractView({
  blocks,
  employeeSigned = false,
  employerSigned = false,
}: {
  blocks: ContractBlock[];
  employeeSigned?: boolean;
  employerSigned?: boolean;
}) {
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-ink-body">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "title":
            return (
              <h3 key={i} className="pb-3 pt-1 text-center text-xl font-bold tracking-[0.3em] text-ink">
                {b.text}
              </h3>
            );
          case "heading":
            return (
              <p key={i} className="pt-3 font-bold text-ink">
                {b.text}
              </p>
            );
          case "para":
            return (
              <p key={i} className="pl-2">
                {b.text}
              </p>
            );
          case "note":
            return (
              <p key={i} className="pl-2 text-ink-muted">
                {b.text}
              </p>
            );
          case "item":
            return (
              <p key={i} className="flex gap-1.5 pl-2">
                <span className="shrink-0">{circled(b.no)}</span>
                <span>{b.text}</span>
              </p>
            );
          case "sub":
            return (
              <p key={i} className="pl-7 text-ink-muted">
                {b.text}
              </p>
            );
          case "confirm":
            return (
              <p key={i} className="flex gap-1.5 pl-2">
                <span className="shrink-0">{circled(b.no)}</span>
                <span>
                  {b.text} <span className="whitespace-nowrap">(인){employeeSigned ? " ✓" : ""}</span>
                </span>
              </p>
            );
          case "party":
            return (
              <table key={i} className="my-2 w-full border-collapse text-[12px]">
                <tbody>
                  {[
                    ["사용자", "기관명", CONTRACT_ORG.name],
                    ["사용자", "대표자", CONTRACT_ORG.representative],
                    ["근로자", "성명", b.party.name],
                    ["근로자", "주민등록번호", b.party.rrn || "(인사기록카드 미입력)"],
                    ["근로자", "주소", b.party.address || "(인사기록카드 미입력)"],
                  ].map(([side, label, value], r) => (
                    <tr key={r}>
                      {(r === 0 || r === 2) && (
                        <th
                          rowSpan={r === 0 ? 2 : 3}
                          className="w-14 border border-ink/60 bg-surface px-1 text-center font-semibold"
                        >
                          {side}
                        </th>
                      )}
                      <th className="w-24 border border-ink/60 bg-surface px-1 py-1.5 text-center font-medium">
                        {label}
                      </th>
                      <td className="border border-ink/60 px-2 py-1.5">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "sign":
            return (
              <div key={i} className="pt-6 text-center">
                <p>{b.date}</p>
                <div className="mt-4 ml-auto w-fit space-y-2 text-left">
                  <p>
                    근로자 : {b.employeeName} (인)
                    {employeeSigned && <span className="ml-1 text-success">서명 완료</span>}
                  </p>
                  <p>
                    고용자 : {CONTRACT_ORG.employerTitle} (인)
                    {employerSigned && <span className="ml-1 text-success">서명 완료</span>}
                  </p>
                </div>
              </div>
            );
        }
      })}
    </div>
  );
}
