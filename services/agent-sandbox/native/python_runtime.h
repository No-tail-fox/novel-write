// Included by sandbox_launcher.cpp; all ACL mutations are on fresh owned copies.
namespace fs = std::filesystem;
struct OwnedTree {
    fs::path root;
    bool created=false;
    void cleanup(){if(created){std::error_code ec; fs::remove_all(root,ec); if(ec) throw Failure{"staging-cleanup",static_cast<DWORD>(ec.value())}; created=false;}}
    ~OwnedTree(){if(created){std::error_code ec; fs::remove_all(root,ec); if(ec) fprintf(stderr,"stagingCleanupError=%d\n",ec.value());}}
};
static void exactAcl(const fs::path& path,PSID sid,bool writable){
    Handle token; check(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.h),"open-owner-token");
    DWORD n=0; GetTokenInformation(token.h,TokenUser,nullptr,0,&n); std::vector<BYTE> user(n);
    check(GetTokenInformation(token.h,TokenUser,user.data(),n,&n),"query-owner");
    Local owner,package,sd;
    check(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,reinterpret_cast<LPWSTR*>(&owner.p)),"owner-sid");
    check(ConvertSidToStringSidW(sid,reinterpret_cast<LPWSTR*>(&package.p)),"package-sid");
    std::wstring sddl=L"D:P(A;OICI;FA;;;"+std::wstring(static_cast<wchar_t*>(owner.p))+L")(A;OICI;"+(writable?L"FA":L"GRGX")+L";;;"+static_cast<wchar_t*>(package.p)+L")";
    check(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,reinterpret_cast<PSECURITY_DESCRIPTOR*>(&sd.p),nullptr),"make-private-acl");
    check(SetFileSecurityW(path.c_str(),DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,sd.p),"set-private-acl");
}
static void writeOwned(const fs::path& path,const std::string& text){
    std::ofstream stream(path,std::ios::binary); stream<<text; stream.close(); if(!stream) throw Failure{"write-owned-file",ERROR_WRITE_FAULT};
}
static int pythonSelfTest(const wchar_t* fixtureParent){
    fs::path base=full(fixtureParent);
    DWORD baseAttributes=GetFileAttributesW(base.c_str());
    if(baseAttributes==INVALID_FILE_ATTRIBUTES || !(baseAttributes&FILE_ATTRIBUTE_DIRECTORY) || (baseAttributes&FILE_ATTRIBUTE_REPARSE_POINT)) throw Failure{"invalid-fixture-parent",ERROR_INVALID_PARAMETER};
    wchar_t self[32768]; DWORD n=GetModuleFileNameW(nullptr,self,32768); check(n>0&&n<32768,"self-path");
    // Fixed bundled distribution relative to the installed launcher; no executable argument.
    fs::path runtime=fs::path(self).parent_path().parent_path().parent_path().parent_path()/L"vendor"/L"python";
    OwnedTree stage; stage.root=base/(L"python-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64()));
    check(CreateDirectoryW(stage.root.c_str(),nullptr),"create-private-stage"); stage.created=true;
    Sid sid; TemporaryProfile profile; profile.name=L"StoryDream.AgentSandbox.Python."+std::to_wstring(GetCurrentProcessId())+L"."+std::to_wstring(GetTickCount64());
    HRESULT hr=CreateAppContainerProfile(profile.name.c_str(),L"Python sandbox",L"Temporary Python confinement fixture",nullptr,0,&sid.p);
    if(FAILED(hr)) throw Failure{"create-python-profile",static_cast<DWORD>(hr)}; profile.created=true;
    exactAcl(stage.root,sid.p,false);
    for(const auto* dir:{L"runtime",L"project",L"out",L"temp"}){fs::path p=stage.root/dir; check(CreateDirectoryW(p.c_str(),nullptr),"create-stage-directory"); exactAcl(p,sid.p,wcscmp(dir,L"out")==0||wcscmp(dir,L"temp")==0);}
    for(const auto& entry:fs::directory_iterator(runtime)){
        DWORD attrs=GetFileAttributesW(entry.path().c_str());
        if(attrs==INVALID_FILE_ATTRIBUTES || (attrs&FILE_ATTRIBUTE_REPARSE_POINT)) throw Failure{"runtime-reparse-point",ERROR_ACCESS_DENIED};
        if(!entry.is_regular_file()) continue;
        const auto ext=entry.path().extension().wstring();
        if(ext!=L".exe"&&ext!=L".dll"&&ext!=L".pyd"&&ext!=L".zip") continue;
        if(ext==L".exe"&&entry.path().filename()!=L"python.exe") continue;
        fs::path dest=stage.root/L"runtime"/entry.path().filename();
        check(CopyFileW(entry.path().c_str(),dest.c_str(),TRUE),"copy-runtime-file"); exactAcl(dest,sid.p,false);
    }
    // LPAC cannot load some normally ambient OS libraries. Stage private copies.
    wchar_t systemDir[MAX_PATH]; check(GetSystemDirectoryW(systemDir,MAX_PATH)!=0,"system-directory");
    for(const auto* name:{L"version.dll",L"bcrypt.dll",L"bcryptprimitives.dll",L"cryptbase.dll",L"ucrtbase.dll",L"ws2_32.dll",L"advapi32.dll",L"sechost.dll",L"rpcrt4.dll",L"kernelbase.dll"}){
        fs::path dest=stage.root/L"runtime"/name;
        check(CopyFileW((fs::path(systemDir)/name).c_str(),dest.c_str(),TRUE),"copy-runtime-system-library"); exactAcl(dest,sid.p,false);
    }
    fs::path pth=stage.root/L"runtime"/L"python312._pth";
    writeOwned(pth,"python312.zip\n.\n"); exactAcl(pth,sid.p,false);
    // A sibling canary has no package grant, even though the parent owns it.
    fs::path canary=stage.root/L"outside.txt";
    writeOwned(canary,"secret canary");
    Handle token; check(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.h),"owner-token");
    DWORD bytes=0; GetTokenInformation(token.h,TokenUser,nullptr,0,&bytes); std::vector<BYTE> ub(bytes);
    check(GetTokenInformation(token.h,TokenUser,ub.data(),bytes,&bytes),"owner-token-user");
    Local owner,sd; check(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(ub.data())->User.Sid,reinterpret_cast<LPWSTR*>(&owner.p)),"owner-text");
    std::wstring deny=L"D:P(A;;FA;;;"+std::wstring(static_cast<wchar_t*>(owner.p))+L")";
    check(ConvertStringSecurityDescriptorToSecurityDescriptorW(deny.c_str(),SDDL_REVISION_1,reinterpret_cast<PSECURITY_DESCRIPTOR*>(&sd.p),nullptr),"canary-sd");
    check(SetFileSecurityW(canary.c_str(),DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,sd.p),"canary-acl");
    const std::string test=R"PY(import os, sys, socket, json, pathlib
root=pathlib.Path(sys.argv[1]); results={}
def denied(name, action):
    try:
        action(); results[name]=False
    except PermissionError: results[name]=True
    except OSError as e: results[name]={'unproven_errno':e.errno,'winerror':getattr(e,'winerror',None)}
def read(p):
    with open(p,'rb') as f: return f.read(16)
def write(p):
    with open(p,'wb') as f: f.write(b'test')
denied('outside_read',lambda:read(root/'outside.txt'))
denied('outside_write',lambda:write(root/'outside.txt'))
denied('project_write',lambda:write(root/'project'/'write.txt'))
denied('runtime_write',lambda:write(root/'runtime'/'write.txt'))
write(root/'out'/'allowed.txt'); write(root/'temp'/'allowed.txt'); results['out_temp_write']=True
# LPAC is not a filesystem namespace: probe ambient OS access explicitly.
denied('strict_os_read',lambda:read(pathlib.Path(os.environ['SystemRoot'])/'System32'/'kernel32.dll'))
for family, host in [(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1'),(socket.AF_INET,'1.1.1.1')]:
    for kind in [socket.SOCK_STREAM,socket.SOCK_DGRAM]:
        def probe():
            with socket.socket(family,kind) as s:
                s.settimeout(1)
                if kind==socket.SOCK_STREAM: s.connect((host,9))
                else: s.sendto(b'probe',(host,9))
        denied('network_'+host+'_'+str(kind),probe)
(root/'out'/'results.json').write_text(json.dumps(results),encoding='utf-8')
)PY";
    fs::path script=stage.root/L"project"/L"fixture.py"; writeOwned(script,test); exactAcl(script,sid.p,false);
    fs::path python=stage.root/L"runtime"/L"python.exe";
    std::wstring args=L" -I -S -B "+quote(script.wstring())+L" "+quote(stage.root.wstring());
    fs::path loader=stage.root/L"runtime"/L"loader.exe";
    check(CopyFileW(self,loader.c_str(),TRUE),"copy-loader"); exactAcl(loader,sid.p,false);
    runProbe(loader.wstring(),(stage.root/L"temp").wstring(),sid.p,false,L" --internal-load-child "+quote((stage.root/L"runtime").wstring())+L" "+quote((stage.root/L"out"/L"loader.txt").wstring()),10000,false);
    std::ifstream diag(stage.root/L"out"/L"loader.txt"); std::string diagnostic((std::istreambuf_iterator<char>(diag)),std::istreambuf_iterator<char>()); fprintf(stderr,"%s",diagnostic.c_str()); diag.close();
    DWORD exit=runProbe(python.wstring(),(stage.root/L"temp").wstring(),sid.p,false,args,15000,false);
    if(exit!=0){ stage.cleanup(); profile.cleanup(); fputs("{\"fixtureCleanup\":true,\"profileDeleted\":true}\n",stderr); throw Failure{"python-fixture-exit",exit}; }
    std::ifstream report(stage.root/L"out"/L"results.json",std::ios::binary);
    std::string result((std::istreambuf_iterator<char>(report)),std::istreambuf_iterator<char>());
    report.close();
    if(result.empty()) throw Failure{"missing-python-results",ERROR_INVALID_DATA};
    printf("pythonConfinement=%s\n",result.c_str());
    writeOwned(script,"import time\ntime.sleep(60)\n"); exactAcl(script,sid.p,false);
    runProbe(python.wstring(),(stage.root/L"temp").wstring(),sid.p,false,args,500,true);
    runProbe(python.wstring(),(stage.root/L"temp").wstring(),sid.p,true,args,500,true);
    writeOwned(script,"import sys\na=[]\ntry:\n while True: a.append(bytearray(1024*1024))\nexcept MemoryError: sys.exit(73)\n"); exactAcl(script,sid.p,false);
    exit=runProbe(python.wstring(),(stage.root/L"temp").wstring(),sid.p,false,args,10000,false);
    if(exit!=73) throw Failure{"memory-limit-not-observed",exit};
    stage.cleanup(); profile.cleanup();
    puts("{\"pythonExecuted\":true,\"timeoutTermination\":true,\"jobCloseCancellation\":true,\"memoryExhaustion\":true,\"cleanup\":true,\"ready\":false,\"reason\":\"Network and user-data isolation gates are not fully proven; production execution remains disabled\"}");
    return 126; // A successful fixture run still cannot satisfy strict filesystem isolation.
}
