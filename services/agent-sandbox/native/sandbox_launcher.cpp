// Windows LPAC launcher. Production execution stays gated on strict filesystem confinement.
#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0A00
#include <winsock2.h>
#include <ws2tcpip.h>
#include <filesystem>
#include <fstream>
#include <iterator>
#pragma comment(lib, "ws2_32.lib")
#include <windows.h>
#include <userenv.h>
#include <sddl.h>
#include <aclapi.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <stdexcept>

#pragma comment(lib, "userenv.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")

struct Handle {
    HANDLE h=nullptr;
    ~Handle(){ if(h && h!=INVALID_HANDLE_VALUE) CloseHandle(h); }
    Handle()=default;
    Handle(const Handle&)=delete;
    Handle& operator=(const Handle&)=delete;
};
struct Failure { const char* step; DWORD error; };
static void check(BOOL ok, const char* step){ if(!ok) throw Failure{step,GetLastError()}; }
struct Local { void* p=nullptr; ~Local(){ if(p) LocalFree(p); } };
struct Sid { PSID p=nullptr; ~Sid(){if(p) FreeSid(p);} };
struct TemporaryProfile {
    std::wstring name;
    bool created=false;
    void cleanup(){ if(created){ HRESULT hr=DeleteAppContainerProfile(name.c_str()); if(FAILED(hr)) throw Failure{"delete-appcontainer-profile",static_cast<DWORD>(hr)}; created=false; } }
    ~TemporaryProfile(){if(created){HRESULT hr=DeleteAppContainerProfile(name.c_str()); if(FAILED(hr)) fprintf(stderr,"profileCleanupError=0x%08lx\n",static_cast<unsigned long>(hr));}}
};
struct Attributes {
    std::vector<BYTE> bytes;
    LPPROC_THREAD_ATTRIBUTE_LIST p=nullptr;
    ~Attributes(){if(p) DeleteProcThreadAttributeList(p);}
};
// Only files created by this process are modified, and are removed after the job closes.
struct Fixture {
    std::wstring root, exe;
    bool created=false, copied=false;
    bool cleanup(){
        bool ok=true;
        if(copied){if(DeleteFileW(exe.c_str())) copied=false; else ok=false;}
        if(created){if(RemoveDirectoryW(root.c_str())) created=false; else ok=false;}
        return ok;
    }
    ~Fixture(){cleanup();}
};
static std::wstring full(const wchar_t* path){
    DWORD n=GetFullPathNameW(path,0,nullptr,nullptr); check(n!=0,"resolve-path");
    std::vector<wchar_t> b(n); check(GetFullPathNameW(path,n,b.data(),nullptr)!=0,"resolve-path"); return b.data();
}
static std::wstring quote(const std::wstring& s){return L"\""+s+L"\"";}
static void verifyToken(HANDLE process, PSID sid){
    Handle t; check(OpenProcessToken(process,TOKEN_QUERY,&t.h),"open-child-token");
    DWORD n=0, isApp=0;
    check(GetTokenInformation(t.h,TokenIsAppContainer,&isApp,sizeof(isApp),&n),"query-appcontainer");
    if(isApp!=1) throw Failure{"not-appcontainer",ERROR_ACCESS_DENIED};
    GetTokenInformation(t.h,TokenAppContainerSid,nullptr,0,&n);
    std::vector<BYTE> b(n); check(GetTokenInformation(t.h,TokenAppContainerSid,b.data(),n,&n),"query-appcontainer-sid");
    if(!EqualSid(reinterpret_cast<TOKEN_APPCONTAINER_INFORMATION*>(b.data())->TokenAppContainer,sid)) throw Failure{"sid-mismatch",ERROR_ACCESS_DENIED};
    GetTokenInformation(t.h,TokenCapabilities,nullptr,0,&n); b.resize(n);
    check(GetTokenInformation(t.h,TokenCapabilities,b.data(),n,&n),"query-capabilities");
    auto* groups=reinterpret_cast<TOKEN_GROUPS*>(b.data());
    if(groups->GroupCount!=0) throw Failure{"unexpected-capabilities",ERROR_ACCESS_DENIED};
}
static DWORD runProbe(const std::wstring& exe,const std::wstring& cwd,PSID sid,bool closeJob,
    const std::wstring& args=L" --internal-proof-child",DWORD timeout=300,bool mustTimeout=true){
    Handle job; job.h=CreateJobObjectW(nullptr,nullptr); check(job.h!=nullptr,"create-job");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_PROCESS_MEMORY|JOB_OBJECT_LIMIT_JOB_MEMORY|JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.BasicLimitInformation.ActiveProcessLimit=1;
    limits.ProcessMemoryLimit=64ULL*1024*1024; limits.JobMemoryLimit=64ULL*1024*1024;
    check(SetInformationJobObject(job.h,JobObjectExtendedLimitInformation,&limits,sizeof(limits)),"set-job-limits");
    Attributes attributes; SIZE_T size=0;
    InitializeProcThreadAttributeList(nullptr,2,0,&size); attributes.bytes.resize(size);
    attributes.p=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.bytes.data());
    check(InitializeProcThreadAttributeList(attributes.p,2,0,&size),"initialize-attributes");
    DWORD packagePolicy=PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
    check(UpdateProcThreadAttribute(attributes.p,0,PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,&packagePolicy,sizeof(packagePolicy),nullptr,nullptr),"lpac-opt-out");
    SECURITY_CAPABILITIES caps{}; caps.AppContainerSid=sid;
    check(UpdateProcThreadAttribute(attributes.p,0,PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,&caps,sizeof(caps),nullptr,nullptr),"security-capabilities");
    STARTUPINFOEXW si{}; si.StartupInfo.cb=sizeof(si); si.lpAttributeList=attributes.p;
    PROCESS_INFORMATION pi{};
    std::wstring cmd=quote(exe)+args;
    // Minimal environment. LPAC creation requires named USERPROFILE/TEMP values.
    wchar_t windowsDir[MAX_PATH]; check(GetWindowsDirectoryW(windowsDir,MAX_PATH)!=0,"windows-directory");
    std::wstring env;
    for(const auto& pair : std::vector<std::wstring>{L"LOCALAPPDATA="+cwd,L"SystemRoot="+std::wstring(windowsDir),L"TEMP="+cwd,L"TMP="+cwd,L"USERPROFILE="+cwd,L"WINDIR="+std::wstring(windowsDir)}) { env+=pair; env.push_back(0); }
    env.push_back(0);
    if(!CreateProcessW(exe.c_str(),cmd.data(),nullptr,nullptr,FALSE,CREATE_SUSPENDED|EXTENDED_STARTUPINFO_PRESENT|CREATE_UNICODE_ENVIRONMENT|CREATE_NO_WINDOW,env.data(),cwd.c_str(),&si.StartupInfo,&pi)) {
        DWORD error=GetLastError();
        using LastStatus=LONG (WINAPI*)();
        auto lastStatus=reinterpret_cast<LastStatus>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"RtlGetLastNtStatus"));
        fprintf(stderr,"nativeStatus=0x%08lx\n",lastStatus ? static_cast<unsigned long>(lastStatus()) : 0UL);
        fwprintf(stderr,L"application=%ls cwd=%ls\n",exe.c_str(),cwd.c_str());
        throw Failure{"create-suspended-appcontainer",error};
    }
    Handle process,thread; process.h=pi.hProcess; thread.h=pi.hThread;
    try {
        check(AssignProcessToJobObject(job.h,process.h),"assign-suspended-job");
        BOOL inJob=FALSE; check(IsProcessInJob(process.h,job.h,&inJob),"query-job-membership");
        if(!inJob) throw Failure{"child-not-in-job",ERROR_ACCESS_DENIED};
        verifyToken(process.h,sid);
        if(ResumeThread(thread.h)==DWORD(-1)) throw Failure{"resume-thread",GetLastError()};
        DWORD wait=WaitForSingleObject(process.h,timeout);
        if(wait==WAIT_OBJECT_0 && !mustTimeout){DWORD code=0; check(GetExitCodeProcess(process.h,&code),"child-exit"); return code;}
        if(wait!=WAIT_TIMEOUT) throw Failure{"probe-exited-before-timeout",wait==WAIT_FAILED?GetLastError():ERROR_PROCESS_ABORTED};
        if(closeJob){CloseHandle(job.h); job.h=nullptr;}
        else check(TerminateJobObject(job.h,124),"terminate-job-timeout");
        if(WaitForSingleObject(process.h,5000)!=WAIT_OBJECT_0) throw Failure{"job-did-not-reap-child",ERROR_TIMEOUT};
        DWORD code=0; check(GetExitCodeProcess(process.h,&code),"get-child-exit");
        if(!closeJob && code!=124) throw Failure{"wrong-timeout-exit",code};
        return code;
    } catch(...) {TerminateProcess(process.h,126); WaitForSingleObject(process.h,5000); throw;}
}
#include "python_runtime.h"
static int preflight(const wchar_t* fixtureParent){
    // The supplied directory is only read. A unique *new* child owns all ACL changes.
    std::wstring base=full(fixtureParent);
    DWORD attr=GetFileAttributesW(base.c_str());
    if(attr==INVALID_FILE_ATTRIBUTES || !(attr&FILE_ATTRIBUTE_DIRECTORY) || (attr&FILE_ATTRIBUTE_REPARSE_POINT)) throw Failure{"invalid-fixture-parent",ERROR_INVALID_PARAMETER};
    wchar_t suffix[80]; swprintf_s(suffix,L"\\appcontainer-proof-%lu-%llu",GetCurrentProcessId(),GetTickCount64());
    Fixture f; f.root=base+suffix; f.exe=f.root+L"\\probe.exe";
    check(CreateDirectoryW(f.root.c_str(),nullptr),"create-new-fixture"); f.created=true;
    wchar_t self[32768]; DWORD len=GetModuleFileNameW(nullptr,self,32768); check(len>0&&len<32768,"self-path");
    check(CopyFileW(self,f.exe.c_str(),TRUE),"copy-native-fixture"); f.copied=true;
    Sid sid;
    std::wstring name=L"StoryDream.AgentSandbox.Proof."+std::to_wstring(GetCurrentProcessId())+L"."+std::to_wstring(GetTickCount64());
    TemporaryProfile profile; profile.name=name;
    HRESULT hr=CreateAppContainerProfile(name.c_str(),L"StoryDream sandbox proof",L"Temporary isolated execution proof",nullptr,0,&sid.p);
    if(FAILED(hr)) throw Failure{"create-temporary-appcontainer-profile",static_cast<DWORD>(hr)};
    profile.created=true;
    Local sidText; check(ConvertSidToStringSidW(sid.p,reinterpret_cast<LPWSTR*>(&sidText.p)),"format-sid");
    PWSTR profilePath=nullptr;
    HRESULT profileResult=GetAppContainerFolderPath(static_cast<wchar_t*>(sidText.p),&profilePath);
    fprintf(stderr,"profileLookupHresult=0x%08lx\n",static_cast<unsigned long>(profileResult));
    if(profilePath) CoTaskMemFree(profilePath);
    Handle token; check(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.h),"open-parent-token");
    DWORD n=0; GetTokenInformation(token.h,TokenUser,nullptr,0,&n); std::vector<BYTE> user(n);
    check(GetTokenInformation(token.h,TokenUser,user.data(),n,&n),"query-user");
    Local userText; check(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,reinterpret_cast<LPWSTR*>(&userText.p)),"format-user-sid");
    // Protected DACL: current user full control, package SID read/execute only.
    // Apply to exact new fixture directory and exact copied file; never recursively edit an existing tree.
    std::wstring sddl=L"D:P(A;;FA;;;"+std::wstring(static_cast<wchar_t*>(userText.p))+L")(A;;GRGX;;;"+std::wstring(static_cast<wchar_t*>(sidText.p))+L")";
    Local sd; check(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,reinterpret_cast<PSECURITY_DESCRIPTOR*>(&sd.p),nullptr),"create-fixture-acl");
    check(SetFileSecurityW(f.root.c_str(),DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,sd.p),"set-new-directory-acl");
    check(SetFileSecurityW(f.exe.c_str(),DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,sd.p),"set-copied-file-acl");
    runProbe(f.exe,f.root,sid.p,false);
    runProbe(f.exe,f.root,sid.p,true);
    if(!f.cleanup()) throw Failure{"fixture-cleanup",GetLastError()};
    profile.cleanup();
    puts("{\"ready\":false,\"productionExecution\":\"disabled\",\"appContainerToken\":true,\"capabilityCount\":0,\"jobAssignedBeforeResume\":true,\"timeoutTermination\":true,\"killOnJobClose\":true,\"memoryLimitsConfigured\":true,\"fixtureAclCleanup\":true,\"reason\":\"Strict filesystem allowlist, network denial, Python runtime, cancellation and memory exhaustion not yet proven\"}");
    return 0;
}
int wmain(int argc,wchar_t** argv){
    if(argc==4 && wcscmp(argv[1],L"--internal-load-child")==0){
        Handle token; DWORD count=0,isApp=0;
        if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.h)||!GetTokenInformation(token.h,TokenIsAppContainer,&isApp,sizeof(isApp),&count)||isApp!=1) return 126;
        std::ofstream report{std::filesystem::path(argv[3])};
        for(const auto* name:{L"kernel32.dll",L"version.dll",L"ws2_32.dll",L"bcrypt.dll",L"advapi32.dll",L"vcruntime140.dll",L"ucrtbase.dll",L"api-ms-win-core-path-l1-1-0.dll",L"api-ms-win-crt-stdio-l1-1-0.dll",L"api-ms-win-crt-environment-l1-1-0.dll",L"api-ms-win-crt-heap-l1-1-0.dll",L"api-ms-win-crt-runtime-l1-1-0.dll",L"api-ms-win-crt-locale-l1-1-0.dll",L"api-ms-win-crt-string-l1-1-0.dll",L"api-ms-win-crt-convert-l1-1-0.dll",L"api-ms-win-crt-math-l1-1-0.dll",L"api-ms-win-crt-time-l1-1-0.dll",L"api-ms-win-crt-process-l1-1-0.dll",L"api-ms-win-crt-conio-l1-1-0.dll",L"api-ms-win-crt-filesystem-l1-1-0.dll",L"python312.dll"}){
            std::wstring path=std::wstring(argv[2])+L"\\"+name;
            HMODULE mod=LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
            if(!mod && GetLastError()==ERROR_MOD_NOT_FOUND) mod=LoadLibraryW(name);
            report<<std::filesystem::path(name).string()<<":"<<(mod?0:GetLastError())<<"\n";
            if(wcscmp(name,L"python312.dll")==0){
                using LastStatus=LONG (WINAPI*)(); auto lastStatus=reinterpret_cast<LastStatus>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"RtlGetLastNtStatus")); report<<"loaderNtStatus:"<<std::hex<<(lastStatus?lastStatus():0)<<std::dec<<"\n";
                HANDLE f=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,0,nullptr); report<<"pythonRead:"<<(f==INVALID_HANDLE_VALUE?GetLastError():0)<<"\n"; if(f!=INVALID_HANDLE_VALUE) CloseHandle(f);
            HMODULE raw=LoadLibraryExW(path.c_str(),nullptr,DONT_RESOLVE_DLL_REFERENCES); report<<"pythonMap:"<<(raw?0:GetLastError())<<"\n";
            if(raw){auto* image=reinterpret_cast<BYTE*>(raw); auto* dos=reinterpret_cast<IMAGE_DOS_HEADER*>(image); auto* nt=reinterpret_cast<IMAGE_NT_HEADERS*>(image+dos->e_lfanew);
                auto* imports=reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(image+nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress);
                for(;imports->Name;++imports){const char* lib=reinterpret_cast<const char*>(image+imports->Name); HMODULE dependency=LoadLibraryA(lib);
                    if(!dependency){report<<"dependency:"<<lib<<":"<<GetLastError()<<"\n"; continue;}
                    auto* thunk=reinterpret_cast<IMAGE_THUNK_DATA*>(image+imports->OriginalFirstThunk);
                    for(;thunk->u1.AddressOfData;++thunk){bool ordinal=IMAGE_SNAP_BY_ORDINAL(thunk->u1.Ordinal)!=0;
                        const char* symbol=ordinal?reinterpret_cast<const char*>(IMAGE_ORDINAL(thunk->u1.Ordinal)):reinterpret_cast<const char*>(reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(image+thunk->u1.AddressOfData)->Name);
                        if(!GetProcAddress(dependency,symbol)) report<<"symbol:"<<lib<<":"<<(ordinal?"ordinal":symbol)<<":"<<GetLastError()<<"\n";
                    }
                }
            }}
        }
        std::filesystem::path root=std::filesystem::path(argv[2]).parent_path();
        for(const auto& path:{root/L"outside.txt",root/L"project"/L"fixture.py",std::filesystem::path(L"C:\\Windows\\System32\\kernel32.dll")}){
            HANDLE f=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,0,nullptr);
            report<<"read:"<<path.filename().string()<<":"<<(f==INVALID_HANDLE_VALUE?GetLastError():0)<<"\n"; if(f!=INVALID_HANDLE_VALUE) CloseHandle(f);
        }
        for(const auto& path:{root/L"outside.txt",root/L"project"/L"denied.txt",root/L"out"/L"allowed-native.txt",root/L"temp"/L"allowed-native.txt"}){
            HANDLE f=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,OPEN_ALWAYS,0,nullptr);
            report<<"write:"<<path.parent_path().filename().string()<<":"<<(f==INVALID_HANDLE_VALUE?GetLastError():0)<<"\n"; if(f!=INVALID_HANDLE_VALUE) CloseHandle(f);
        }
        WSADATA data{}; int startup=WSAStartup(MAKEWORD(2,2),&data); report<<"wsaStartup:"<<startup<<"\n";
        if(startup==0){for(int family:{AF_INET,AF_INET6}) for(int kind:{SOCK_STREAM,SOCK_DGRAM}){
            SOCKET s=socket(family,kind,0); int error=0;
            if(s==INVALID_SOCKET) error=WSAGetLastError();
            else {u_long nonblock=1; ioctlsocket(s,FIONBIO,&nonblock); sockaddr_storage address{}; int length=0;
                if(family==AF_INET){auto* a=reinterpret_cast<sockaddr_in*>(&address); a->sin_family=AF_INET; a->sin_port=htons(9); a->sin_addr.s_addr=htonl(INADDR_LOOPBACK); length=sizeof(*a);}
                else {auto* a=reinterpret_cast<sockaddr_in6*>(&address); a->sin6_family=AF_INET6; a->sin6_port=htons(9); a->sin6_addr=in6addr_loopback; length=sizeof(*a);}
                int rc=kind==SOCK_STREAM?connect(s,reinterpret_cast<sockaddr*>(&address),length):sendto(s,"x",1,0,reinterpret_cast<sockaddr*>(&address),length);
                if(rc==SOCKET_ERROR) error=WSAGetLastError(); closesocket(s);
            }
            report<<"loopback:"<<family<<":"<<kind<<":"<<error<<"\n";
        } WSACleanup();}
        return 0;
    }
    if(argc==2 && wcscmp(argv[1],L"--internal-proof-child")==0){
        Handle token; DWORD n=0,isApp=0;
        if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.h)||!GetTokenInformation(token.h,TokenIsAppContainer,&isApp,sizeof(isApp),&n)||isApp!=1) return 126;
        Sleep(INFINITE); return 126;
    }
    if(argc==3 && (wcscmp(argv[1],L"--preflight-fixture")==0 || wcscmp(argv[1],L"--python-self-test")==0)){
        try {return wcscmp(argv[1],L"--python-self-test")==0 ? pythonSelfTest(argv[2]) : preflight(argv[2]);}
        catch(const Failure& f){fprintf(stderr,"{\"ready\":false,\"step\":\"%s\",\"win32Error\":%lu}\n",f.step,f.error); return 126;}
        catch(...){fputs("{\"ready\":false,\"reason\":\"unexpected preflight failure\"}\n",stderr); return 126;}
    }
    puts("{\"ready\":false,\"productionExecution\":\"disabled\",\"reason\":\"Sandbox confinement has not been fully proven; refusing all payload execution\"}");
    return 126;
}
