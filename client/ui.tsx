import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

export type Theme = PluginTheme;

export function Section({theme,title,subtitle,children}:{theme:Theme;title:string;subtitle?:string;children:ReactNode}){
  return <View style={{gap:10,marginBottom:8}}>
    <View style={{gap:3}}><Text style={{fontSize:17,fontWeight:"700",color:theme.colors.foreground}}>{title}</Text>
      {subtitle?<Text style={{color:theme.colors.foregroundMuted,fontSize:12,lineHeight:18}}>{subtitle}</Text>:null}</View>
    <View style={{padding:14,borderWidth:1,borderColor:theme.colors.border,borderRadius:12,backgroundColor:theme.colors.surface1,gap:12}}>{children}</View>
  </View>;
}
export function Button({theme,label,onPress,disabled=false,subtle=false}:{theme:Theme;label:string;onPress:()=>void;disabled?:boolean;subtle?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({pressed})=>({borderWidth:1,borderColor:subtle?theme.colors.border:theme.colors.accent,backgroundColor:subtle?theme.colors.surface2:theme.colors.accent,
      borderRadius:9,paddingHorizontal:13,paddingVertical:9,alignSelf:"flex-start",maxWidth:"100%",opacity:disabled?0.45:pressed?0.75:1})}>
    <Text style={{color:subtle?theme.colors.foreground:theme.colors.accentForeground,fontSize:13,fontWeight:"600"}}>{label}</Text>
  </Pressable>;
}
export function Choice({theme,label,selected,onPress}:{theme:Theme;label:string;selected:boolean;onPress:()=>void}){
  return <Pressable accessibilityRole="button" accessibilityState={{selected}} onPress={onPress} style={{paddingVertical:7,paddingHorizontal:12,borderRadius:18,borderWidth:1,maxWidth:"100%",
    borderColor:selected?theme.colors.accent:theme.colors.border,backgroundColor:selected?theme.colors.surface2:theme.colors.surface1}}>
    <Text style={{fontSize:12,fontWeight:selected?"700":"400",color:selected?theme.colors.accent:theme.colors.foreground}}>{label}</Text>
  </Pressable>;
}
export function Field({theme,label,helper,multiline=false,value,onChangeText,placeholder,editable=true}:{theme:Theme;label:string;helper?:string;multiline?:boolean;value:string;onChangeText:(value:string)=>void;placeholder?:string;editable?:boolean}){
  return <View style={{gap:5}}>
    <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.colors.foregroundMuted}
      editable={editable} multiline={multiline} textAlignVertical={multiline?"top":"center"} autoCapitalize="none" autoCorrect={false}
      style={{color:theme.colors.foreground,backgroundColor:theme.colors.surface2,borderWidth:1,borderColor:theme.colors.border,
        borderRadius:8,paddingVertical:9,paddingHorizontal:11,fontSize:13,minHeight:multiline?100:37,maxHeight:multiline?230:undefined}} />
    {helper?<Text style={{fontSize:11,color:theme.colors.foregroundMuted}}>{helper}</Text>:null}
  </View>;
}
export function Notice({theme,text,kind="info"}:{theme:Theme;text:string;kind?:"error"|"success"|"info"}){
  const color=kind==="error"?theme.colors.statusDanger:kind==="success"?theme.colors.statusSuccess:theme.colors.foregroundMuted;
  return <Text selectable style={{color,fontSize:12,lineHeight:18}}>{text}</Text>;
}
export function Status({theme,status}:{theme:Theme;status:string}){
  const positive=["done","completed","idle"].includes(status);
  const negative=["failed","error","canceled"].includes(status);
  const color=negative?theme.colors.statusDanger:positive?theme.colors.statusSuccess:theme.colors.statusWarning;
  return <Text style={{fontSize:11,color,fontWeight:"600"}}>{status}</Text>;
}
export function Wrap({children}:{children:ReactNode}){
  return <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:7}}>{children}</View>;
}
